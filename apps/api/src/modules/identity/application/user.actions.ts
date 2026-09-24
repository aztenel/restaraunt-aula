import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { randomCode } from '../../../shared/kernel/random';
import { assertPasswordStrength } from '../domain/password-policy';
import { validateRoleAssignments } from '../domain/role-assignment';
import { RoleAssignment } from '../domain/roles';
import { BranchRepository } from '../infrastructure/branch.repository';
import { RefreshTokenRepository } from '../infrastructure/refresh-token.repository';
import { UserRecord, UserRepository } from '../infrastructure/user.repository';
import { ActorResolver } from './actor-resolver';
import { PasswordHasher } from './password-hasher';

export interface StaffUserView {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: RoleAssignment[];
}

export function toStaffUserView(u: UserRecord): StaffUserView {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    telegramChatId: u.telegramChatId,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roles: u.roles,
  };
}

function generateTemporaryPassword(): string {
  // Префикс гарантирует три класса символов (заглавные, строчные, символ), хвост — 60 бит энтропии.
  return `Tmp!${randomCode(12)}x`;
}

async function assertBranchesExist(branches: BranchRepository, roles: RoleAssignment[]): Promise<void> {
  for (const r of roles) {
    if (r.branchId && !(await branches.findById(r.branchId))) {
      throw new ValidationError('user.unknown_branch', 'Branch not found', { branchId: r.branchId });
    }
  }
}

/** Защита от потери управления: нельзя убрать последнего активного собственника или администратора. */
async function assertKeepsPrivilegedAccess(users: UserRepository, user: UserRecord, nextRoles: RoleAssignment[], nextActive: boolean) {
  for (const role of ['owner', 'sysadmin'] as const) {
    const had = user.isActive && user.roles.some((r) => r.role === role);
    const keeps = nextActive && nextRoles.some((r) => r.role === role);
    if (had && !keeps && (await users.countActiveWithRole(role)) <= 1) {
      throw new ConflictError('user.last_privileged', `Cannot remove the last active ${role}`, { role });
    }
  }
}

@Injectable()
export class CreateStaffUser {
  constructor(
    private readonly users: UserRepository,
    private readonly branches: BranchRepository,
    private readonly hasher: PasswordHasher,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(
    actor: Actor,
    input: {
      email: string;
      name: string;
      phone?: string | null;
      telegramChatId?: string | null;
      password?: string | null;
      roles: Array<{ role: string; branchId?: string | null }>;
    },
  ): Promise<{ user: StaffUserView; temporaryPassword: string | null }> {
    actor.assertCan(Permission.UsersManage);
    const roles = validateRoleAssignments(input.roles);
    await assertBranchesExist(this.branches, roles);
    if (await this.users.findByEmail(input.email)) {
      throw new ConflictError('user.email_taken', 'User with this email already exists');
    }
    const temporaryPassword = input.password ? null : generateTemporaryPassword();
    const password = input.password ?? temporaryPassword!;
    assertPasswordStrength(password);
    const hash = await this.hasher.hash(password);
    const id = newId();
    const phone = input.phone ? tryNormalizePhone(input.phone) : null;
    if (input.phone && !phone) throw new ValidationError('phone.invalid', 'Invalid phone');
    await this.database.transaction(async () => {
      await this.users.insert({
        id,
        email: input.email,
        name: input.name.trim(),
        phone,
        telegramChatId: input.telegramChatId ?? null,
        passwordHash: hash,
        mustChangePassword: true,
      });
      await this.users.replaceRoles(id, roles);
      await this.audit.record({
        action: 'user.created',
        entityType: 'user',
        entityId: id,
        after: { email: input.email, name: input.name, roles },
      });
    });
    const user = (await this.users.findById(id))!;
    return { user: toStaffUserView(user), temporaryPassword };
  }
}

@Injectable()
export class UpdateStaffUser {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly actors: ActorResolver,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    userId: string,
    patch: { name?: string; email?: string; phone?: string | null; telegramChatId?: string | null; isActive?: boolean },
  ): Promise<StaffUserView> {
    actor.assertCan(Permission.UsersManage);
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('user', userId);
    if (patch.email && patch.email.toLowerCase() !== user.email) {
      const other = await this.users.findByEmail(patch.email);
      if (other && other.id !== userId) throw new ConflictError('user.email_taken', 'Email already in use');
    }
    if (patch.isActive === false) {
      if (actor.userId === userId) throw new ConflictError('user.cannot_deactivate_self', 'You cannot deactivate yourself');
      await assertKeepsPrivilegedAccess(this.users, user, user.roles, false);
    }
    let phone: string | null | undefined = patch.phone;
    if (patch.phone) {
      phone = tryNormalizePhone(patch.phone);
      if (!phone) throw new ValidationError('phone.invalid', 'Invalid phone');
    }
    await this.database.transaction(async () => {
      await this.users.updateProfile(userId, { ...patch, phone });
      if (patch.isActive === false) await this.refreshTokens.revokeAllForUser(userId, this.clock.now());
      await this.audit.record({
        action: patch.isActive === false ? 'user.deactivated' : 'user.updated',
        entityType: 'user',
        entityId: userId,
        before: { name: user.name, email: user.email, phone: user.phone, isActive: user.isActive },
        after: patch,
      });
    });
    this.actors.invalidate(userId);
    return toStaffUserView((await this.users.findById(userId))!);
  }
}

@Injectable()
export class SetUserRoles {
  constructor(
    private readonly users: UserRepository,
    private readonly branches: BranchRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly actors: ActorResolver,
  ) {}

  async execute(actor: Actor, userId: string, input: Array<{ role: string; branchId?: string | null }>): Promise<StaffUserView> {
    actor.assertCan(Permission.UsersManage);
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('user', userId);
    const roles = validateRoleAssignments(input);
    await assertBranchesExist(this.branches, roles);
    await assertKeepsPrivilegedAccess(this.users, user, roles, user.isActive);
    await this.database.transaction(async () => {
      await this.users.replaceRoles(userId, roles);
      await this.audit.record({
        action: 'user.roles_changed',
        entityType: 'user',
        entityId: userId,
        before: user.roles,
        after: roles,
      });
    });
    this.actors.invalidate(userId);
    return toStaffUserView((await this.users.findById(userId))!);
  }
}

@Injectable()
export class ResetUserPassword {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, userId: string): Promise<{ temporaryPassword: string }> {
    actor.assertCan(Permission.UsersManage);
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError('user', userId);
    const temporaryPassword = generateTemporaryPassword();
    const hash = await this.hasher.hash(temporaryPassword);
    await this.database.transaction(async () => {
      await this.users.setPassword(userId, hash, true);
      await this.refreshTokens.revokeAllForUser(userId, this.clock.now());
      await this.audit.record({ action: 'user.password_reset', entityType: 'user', entityId: userId });
    });
    return { temporaryPassword };
  }
}
