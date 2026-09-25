import { useMemo } from 'react';
import { useAuth } from '@/shared/auth/AuthProvider';
import { branchMenuAbilities, catalogAbilities, type BranchMenuAbilities, type CatalogAbilities } from './abilities';

/** Действия с каталогом для текущего сотрудника (см. abilities.ts). */
export function useCatalogAbilities(): CatalogAbilities {
  const { me } = useAuth();
  return useMemo(() => catalogAbilities(me), [me]);
}

/** Действия с меню конкретного филиала (цены, стоп-лист). */
export function useBranchMenuAbilities(branchId: string | null): BranchMenuAbilities {
  const { me } = useAuth();
  return useMemo(() => branchMenuAbilities(me, branchId), [me, branchId]);
}
