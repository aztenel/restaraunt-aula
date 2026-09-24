/**
 * Проверка прав на клиенте — зеркало семантики Actor на бэкенде (shared/kernel/actor.ts):
 *  - can(permission, branchId): глобальное право ИЛИ право в указанном филиале;
 *    без филиала — только глобальное (действие над всеми филиалами);
 *  - canSomewhere(permission): право хотя бы в одном филиале (доступ к разделу меню).
 * Это только UX (скрыть недоступное): окончательную проверку всегда делает сервер.
 */
import { Permission } from '@aula/api-client';

export { Permission };

export interface PermissionSnapshot {
  globalPermissions: readonly string[];
  branchPermissions: Readonly<Record<string, readonly string[]>>;
}

export function can(snapshot: PermissionSnapshot | null | undefined, permission: Permission, branchId?: string | null): boolean {
  if (!snapshot) return false;
  if (snapshot.globalPermissions.includes(permission)) return true;
  if (!branchId) return false;
  return snapshot.branchPermissions[branchId]?.includes(permission) ?? false;
}

export function canSomewhere(snapshot: PermissionSnapshot | null | undefined, permission: Permission): boolean {
  if (!snapshot) return false;
  if (snapshot.globalPermissions.includes(permission)) return true;
  return Object.values(snapshot.branchPermissions).some((perms) => perms.includes(permission));
}

/** Хотя бы одно из прав хотя бы в одном филиале (так работает @RequirePermissions на бэкенде). */
export function canAnySomewhere(snapshot: PermissionSnapshot | null | undefined, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => canSomewhere(snapshot, p));
}

/** Филиалы, где есть право: 'all' — глобальное право. */
export function branchesWith(snapshot: PermissionSnapshot | null | undefined, permission: Permission): 'all' | string[] {
  if (!snapshot) return [];
  if (snapshot.globalPermissions.includes(permission)) return 'all';
  return Object.entries(snapshot.branchPermissions)
    .filter(([, perms]) => perms.includes(permission))
    .map(([branchId]) => branchId);
}

/** У пользователя есть глобальные права (видит все филиалы, может выбрать «Все филиалы»). */
export function hasGlobalScope(snapshot: PermissionSnapshot | null | undefined): boolean {
  return Boolean(snapshot && snapshot.globalPermissions.length > 0);
}

/**
 * Право в контексте выбранного в шапке филиала: выбран филиал — глобальное или в нём;
 * выбраны «Все филиалы» (null) — только глобальное.
 */
export function canInSelection(
  snapshot: PermissionSnapshot | null | undefined,
  permission: Permission,
  selectedBranchId: string | null,
): boolean {
  return can(snapshot, permission, selectedBranchId);
}
