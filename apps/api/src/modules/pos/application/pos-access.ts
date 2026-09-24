import { Actor } from '../../../shared/kernel/actor';
import { ForbiddenError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';

/**
 * Права раздела POS:
 * - операционные действия по точке (статус, передачи заказов, повтор, синхронизация стоп-листа) —
 *   администратор интеграций или сотрудник, ведущий заказы филиала (orders.manage в филиале);
 * - настройка сопоставления и импорт номенклатуры — только integrations.manage.
 */
export const POS_OPERATIONS_PERMISSIONS = [Permission.IntegrationsManage, Permission.OrdersManage] as const;

export function canOperatePos(actor: Actor, branchId: string): boolean {
  return actor.can(Permission.IntegrationsManage, branchId) || actor.can(Permission.OrdersManage, branchId);
}

export function assertCanOperatePos(actor: Actor, branchId: string): void {
  if (!canOperatePos(actor, branchId)) {
    throw new ForbiddenError('access.forbidden', 'Permission integrations.manage or orders.manage required', {
      permission: Permission.OrdersManage,
      branchId,
    });
  }
}

/**
 * Филиалы, доступные для операционных списков: объединение филиалов с integrations.manage и orders.manage.
 * Запрос чужого филиала — ForbiddenError.
 */
export function scopePosBranches(actor: Actor, requested?: string | null): 'all' | string[] {
  const integrations = actor.branchesWith(Permission.IntegrationsManage);
  const orders = actor.branchesWith(Permission.OrdersManage);
  const allowed: 'all' | string[] = integrations === 'all' || orders === 'all' ? 'all' : [...new Set([...integrations, ...orders])];
  if (requested) {
    if (allowed !== 'all' && !allowed.includes(requested)) {
      throw new ForbiddenError('access.forbidden_branch', 'No access to this branch', { branchId: requested });
    }
    return [requested];
  }
  if (allowed !== 'all' && allowed.length === 0) {
    throw new ForbiddenError('access.forbidden', 'Permission integrations.manage or orders.manage required');
  }
  return allowed;
}
