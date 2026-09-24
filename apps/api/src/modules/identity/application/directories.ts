import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { isOpenAt } from '../../../shared/kernel/time';
import { ROLE_DEFINITIONS, STAFF_ROLES } from '../domain/roles';
import { BranchRepository } from '../infrastructure/branch.repository';
import { LegalEntityRepository } from '../infrastructure/legal-entity.repository';
import { UserRecord, UserRepository } from '../infrastructure/user.repository';
import { BranchDirectory, BranchInfo } from '../public/branch-directory';
import { IdentityEvents } from '../public/events';
import { LegalEntityDirectory, LegalEntityInfo } from '../public/legal-entities';
import { StaffDirectory, StaffMember, StaffRole } from '../public/staff-directory';

const TTL_MS = 15_000;

@Injectable()
export class BranchDirectoryService extends BranchDirectory {
  private cache: { at: number; branches: BranchInfo[] } | null = null;

  constructor(private readonly repo: BranchRepository) {
    super();
  }

  private async all(): Promise<BranchInfo[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.branches;
    const branches = await this.repo.list(false);
    this.cache = { at: Date.now(), branches };
    return branches;
  }

  invalidate(): void {
    this.cache = null;
  }

  @OnEvent(IdentityEvents.BranchChanged)
  async onBranchChanged(): Promise<void> {
    this.invalidate();
  }

  async get(branchId: string): Promise<BranchInfo> {
    const branch = await this.find(branchId);
    if (!branch) throw new NotFoundError('branch', branchId);
    return branch;
  }

  async find(branchId: string): Promise<BranchInfo | null> {
    const cached = (await this.all()).find((b) => b.id === branchId);
    return cached ?? (await this.repo.findById(branchId));
  }

  async findBySlug(slug: string): Promise<BranchInfo | null> {
    return (await this.all()).find((b) => b.slug === slug) ?? (await this.repo.findBySlug(slug));
  }

  async list(options: { activeOnly?: boolean } = {}): Promise<BranchInfo[]> {
    const all = await this.all();
    return options.activeOnly ? all.filter((b) => b.isActive) : all;
  }

  async isOpenAt(branchId: string, at: Date): Promise<boolean> {
    const branch = await this.get(branchId);
    return isOpenAt(branch.openingHours, at, branch.timezone);
  }
}

@Injectable()
export class LegalEntityDirectoryService extends LegalEntityDirectory {
  constructor(
    private readonly repo: LegalEntityRepository,
    private readonly branches: BranchRepository,
  ) {
    super();
  }

  async get(id: string): Promise<LegalEntityInfo> {
    const entity = await this.repo.findById(id);
    if (!entity) throw new NotFoundError('legal_entity', id);
    return entity;
  }

  async forBranch(branchId: string | null): Promise<LegalEntityInfo> {
    if (branchId) {
      const branch = await this.branches.findById(branchId);
      if (branch?.legalEntityId) return this.get(branch.legalEntityId);
    }
    const def = await this.repo.findDefault();
    if (!def) throw new NotFoundError('legal_entity', 'default');
    return def;
  }
}

function toMember(u: UserRecord): StaffMember {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, telegramChatId: u.telegramChatId, isActive: u.isActive };
}

@Injectable()
export class StaffDirectoryService extends StaffDirectory {
  constructor(private readonly users: UserRepository) {
    super();
  }

  async get(userId: string): Promise<StaffMember | null> {
    const u = await this.users.findById(userId);
    return u ? toMember(u) : null;
  }

  async withRole(role: StaffRole, branchId?: string | null): Promise<StaffMember[]> {
    const users = await this.users.activeWithRoles([role], branchId ?? null);
    return users.filter((u) => u.roles.some((r) => r.role === role && (!branchId || !r.branchId || r.branchId === branchId))).map(toMember);
  }

  async withPermission(permission: Permission, branchId?: string | null): Promise<StaffMember[]> {
    const roles = STAFF_ROLES.filter((r) => ROLE_DEFINITIONS[r].permissions.includes(permission));
    const users = await this.users.activeWithRoles(roles, branchId ?? null);
    return users
      .filter((u) =>
        u.roles.some(
          (r) =>
            roles.includes(r.role) &&
            (ROLE_DEFINITIONS[r.role].scope === 'global' || (branchId !== null && branchId !== undefined && r.branchId === branchId)),
        ),
      )
      .map(toMember);
  }
}
