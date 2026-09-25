import { useMemo } from 'react';
import { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { can } from '@/shared/auth/permissions';
import { useBranch } from '@/shared/branch/BranchProvider';
import { canEditBanner, canEditPages, canEditPromotion, canViewContent } from '../menu/abilities';

/** Права контента для текущего сотрудника: общий контент — глобально, филиальный — в филиале. */
export function useContentAbilities() {
  const { me } = useAuth();
  const { branches } = useBranch();
  return useMemo(() => {
    const editableBranchIds = branches.filter((b) => can(me, Permission.ContentManage, b.id)).map((b) => b.id);
    return {
      view: canViewContent(me),
      /** Общий (для всех филиалов) баннер/акция и страницы. */
      global: can(me, Permission.ContentManage),
      editableBranchIds,
      pages: canEditPages(me),
      banner: (branchId: string | null) => canEditBanner(me, branchId),
      promotion: (branchIds: readonly string[]) => canEditPromotion(me, branchIds),
    };
  }, [me, branches]);
}
