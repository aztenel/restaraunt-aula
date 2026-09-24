import { useCallback, useMemo } from 'react';
import type { Permission } from '@aula/api-client';
import { useBranch } from '../branch/BranchProvider';
import { useAuth } from './AuthProvider';
import { branchesWith, can, canAnySomewhere, canSomewhere } from './permissions';

/**
 * Проверки прав текущего сотрудника.
 *   const { can, canHere, canSomewhere } = useCan();
 *   can('orders.manage', order.branchId)  — конкретный филиал;
 *   canHere('orders.manage')              — выбранный в шапке филиал (или глобально для «Все филиалы»);
 *   canSomewhere('orders.view')           — хоть в одном филиале (видимость раздела).
 */
export function useCan() {
  const { me } = useAuth();
  const { selectedBranchId } = useBranch();
  const canFn = useCallback((permission: Permission, branchId?: string | null) => can(me, permission, branchId), [me]);
  const canHere = useCallback((permission: Permission) => can(me, permission, selectedBranchId), [me, selectedBranchId]);
  const canSomewhereFn = useCallback((permission: Permission) => canSomewhere(me, permission), [me]);
  const canAny = useCallback((permissions: readonly Permission[]) => canAnySomewhere(me, permissions), [me]);
  const branchesWithFn = useCallback((permission: Permission) => branchesWith(me, permission), [me]);
  return useMemo(
    () => ({ can: canFn, canHere, canSomewhere: canSomewhereFn, canAny, branchesWith: branchesWithFn }),
    [canFn, canHere, canSomewhereFn, canAny, branchesWithFn],
  );
}
