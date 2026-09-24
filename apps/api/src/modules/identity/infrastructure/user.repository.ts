import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { RoleAssignment } from '../domain/roles';
import { StaffRole } from '../public/staff-directory';
import { IdentityTables, UsersTable } from './identity.tables';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  telegramChatId: string | null;
  passwordHash: string;
  isActive: boolean;
  mustChangePassword: boolean;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  roles: RoleAssignment[];
}

function mapUser(row: Selectable<UsersTable>, roles: RoleAssignment[]): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    telegramChatId: row.telegram_chat_id,
    passwordHash: row.password_hash,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    roles,
  };
}

@Injectable()
export class UserRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<IdentityTables>();
  }

  private async rolesOf(userIds: string[]): Promise<Map<string, RoleAssignment[]>> {
    const map = new Map<string, RoleAssignment[]>();
    if (userIds.length === 0) return map;
    const rows = await this.db()
      .selectFrom('identity.user_roles')
      .select(['user_id', 'role', 'branch_id'])
      .where('user_id', 'in', userIds)
      .execute();
    for (const r of rows) {
      map.set(r.user_id, [...(map.get(r.user_id) ?? []), { role: r.role as StaffRole, branchId: r.branch_id }]);
    }
    return map;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db()
      .selectFrom('identity.users')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    const roles = await this.rolesOf([id]);
    return mapUser(row, roles.get(id) ?? []);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db()
      .selectFrom('identity.users')
      .selectAll()
      .where('email', '=', email.trim().toLowerCase())
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) return null;
    const roles = await this.rolesOf([row.id]);
    return mapUser(row, roles.get(row.id) ?? []);
  }

  async search(filter: { q?: string; role?: string; branchId?: string; activeOnly?: boolean }, page: PageRequest): Promise<Page<UserRecord>> {
    let q = this.db().selectFrom('identity.users').where('deleted_at', 'is', null);
    if (filter.q) {
      const like = `%${filter.q.toLowerCase()}%`;
      q = q.where((eb) => eb.or([eb(eb.fn('lower', ['name']), 'like', like), eb(eb.fn('lower', ['email']), 'like', like)]));
    }
    if (filter.activeOnly) q = q.where('is_active', '=', true);
    if (filter.role || filter.branchId) {
      q = q.where('id', 'in', (eb) => {
        let sub = eb.selectFrom('identity.user_roles').select('user_id');
        if (filter.role) sub = sub.where('role', '=', filter.role);
        if (filter.branchId) sub = sub.where('branch_id', '=', filter.branchId);
        return sub;
      });
    }
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('name').limit(page.perPage).offset(offsetOf(page)).execute();
    const roles = await this.rolesOf(rows.map((r) => r.id));
    return pageOf(
      rows.map((r) => mapUser(r, roles.get(r.id) ?? [])),
      Number(total?.n ?? 0),
      page,
    );
  }

  async insert(user: {
    id: string;
    email: string;
    name: string;
    phone: string | null;
    telegramChatId: string | null;
    passwordHash: string;
    mustChangePassword: boolean;
  }): Promise<void> {
    await this.db()
      .insertInto('identity.users')
      .values({
        id: user.id,
        email: user.email.trim().toLowerCase(),
        name: user.name,
        phone: user.phone,
        telegram_chat_id: user.telegramChatId,
        password_hash: user.passwordHash,
        is_active: true,
        must_change_password: user.mustChangePassword,
        failed_login_count: 0,
        locked_until: null,
        last_login_at: null,
        deleted_at: null,
      })
      .execute();
  }

  async updateProfile(
    id: string,
    patch: Partial<{ name: string; email: string; phone: string | null; telegramChatId: string | null; isActive: boolean }>,
  ): Promise<void> {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.email !== undefined) set.email = patch.email.trim().toLowerCase();
    if (patch.phone !== undefined) set.phone = patch.phone;
    if (patch.telegramChatId !== undefined) set.telegram_chat_id = patch.telegramChatId;
    if (patch.isActive !== undefined) set.is_active = patch.isActive;
    if (Object.keys(set).length === 0) return;
    await this.db().updateTable('identity.users').set(set).where('id', '=', id).execute();
  }

  async setPassword(id: string, hash: string, mustChange: boolean): Promise<void> {
    await this.db()
      .updateTable('identity.users')
      .set({ password_hash: hash, must_change_password: mustChange, failed_login_count: 0, locked_until: null })
      .where('id', '=', id)
      .execute();
  }

  async recordLoginFailure(id: string, failedCount: number, lockedUntil: Date | null): Promise<void> {
    await this.db()
      .updateTable('identity.users')
      .set({ failed_login_count: failedCount, locked_until: lockedUntil })
      .where('id', '=', id)
      .execute();
  }

  async recordLoginSuccess(id: string, at: Date): Promise<void> {
    await this.db()
      .updateTable('identity.users')
      .set({ failed_login_count: 0, locked_until: null, last_login_at: at })
      .where('id', '=', id)
      .execute();
  }

  async replaceRoles(userId: string, roles: RoleAssignment[]): Promise<void> {
    await this.db().deleteFrom('identity.user_roles').where('user_id', '=', userId).execute();
    if (roles.length === 0) return;
    await this.db()
      .insertInto('identity.user_roles')
      .values(roles.map((r) => ({ id: newId(), user_id: userId, role: r.role, branch_id: r.branchId })))
      .execute();
  }

  /** Активные пользователи с одной из ролей (для филиала: роль в филиале или глобальная). */
  async activeWithRoles(roles: StaffRole[], branchId: string | null): Promise<UserRecord[]> {
    if (roles.length === 0) return [];
    let sub = this.db().selectFrom('identity.user_roles').select('user_id').where('role', 'in', roles);
    if (branchId) {
      sub = sub.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    }
    const rows = await this.db()
      .selectFrom('identity.users')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('is_active', '=', true)
      .where('id', 'in', sub)
      .orderBy('name')
      .execute();
    const rolesMap = await this.rolesOf(rows.map((r) => r.id));
    return rows.map((r) => mapUser(r, rolesMap.get(r.id) ?? []));
  }

  async countActiveWithRole(role: StaffRole): Promise<number> {
    const row = await this.db()
      .selectFrom('identity.user_roles as r')
      .innerJoin('identity.users as u', 'u.id', 'r.user_id')
      .where('r.role', '=', role)
      .where('u.is_active', '=', true)
      .where('u.deleted_at', 'is', null)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
