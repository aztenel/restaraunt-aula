/**
 * Права раздела POS (зеркало pos/application/pos-access.ts, только UX):
 *  - операционные действия по точке (статус, передачи заказов, повтор, синхронизация стоп-листа) —
 *    integrations.manage или orders.manage в филиале;
 *  - сопоставление блюд, номенклатура и её импорт — integrations.manage в филиале (или глобально).
 */
import { useMemo } from 'react';
import { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { can, canSomewhere, type PermissionSnapshot } from '@/shared/auth/permissions';

export function posAbilities(me: PermissionSnapshot | null | undefined) {
  return {
    canOperate: (branchId: string) => can(me, Permission.IntegrationsManage, branchId) || can(me, Permission.OrdersManage, branchId),
    canConfigure: (branchId: string) => can(me, Permission.IntegrationsManage, branchId),
    /** Разделы сопоставления и номенклатуры видны. */
    canIntegrations: canSomewhere(me, Permission.IntegrationsManage),
  };
}

export function usePosAbilities() {
  const { me } = useAuth();
  return useMemo(() => posAbilities(me), [me]);
}
