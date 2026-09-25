import { Permission } from '../../../shared/kernel/permissions';

export const StaffRole = {
  BranchOperator: 'branch_operator',
  BanquetManager: 'banquet_manager',
  BranchManager: 'branch_manager',
  ContentManager: 'content_manager',
  Finance: 'finance',
  Owner: 'owner',
  SystemAdmin: 'sysadmin',
} as const;
export type StaffRole = (typeof StaffRole)[keyof typeof StaffRole];

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  telegramChatId: string | null;
  isActive: boolean;
}

/** Сотрудники: для автоназначения банкетных менеджеров и адресных уведомлений персоналу. */
export abstract class StaffDirectory {
  abstract get(userId: string): Promise<StaffMember | null>;
  /** Активные сотрудники с ролью (в филиале или глобально, если branchId не задан). */
  abstract withRole(role: StaffRole, branchId?: string | null): Promise<StaffMember[]>;
  /** Активные сотрудники, у которых есть право в филиале (глобальные роли включаются). */
  abstract withPermission(permission: Permission, branchId?: string | null): Promise<StaffMember[]>;

  /**
   * Имена сотрудников по id — для подписей «кто сделал» в админке (без права users.manage).
   * Пустые id пропускаются; неизвестный сотрудник в результат не попадает.
   */
  async names(userIds: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    for (const id of new Set(userIds.filter((u): u is string => typeof u === 'string' && u.length > 0))) {
      const member = await this.get(id);
      if (member) result.set(id, member.name);
    }
    return result;
  }
}
