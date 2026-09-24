import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { StaffRole } from '@aula/api-client';
import { usersApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { tx } from '@/shared/i18n/tx';

/** Роли и их названия (GET /admin/users/roles; запасной вариант — словарь i18n). */
export function useRoleDefinitions() {
  const { t, i18n } = useTranslation();
  const query = useQuery({ queryKey: queryKeys.roles, queryFn: usersApi.roles, staleTime: 10 * 60_000 });
  const roleTitle = useCallback(
    (role: StaffRole | string) => {
      const def = query.data?.find((d) => d.role === role);
      const lang = i18n.language === 'kk' ? 'kk' : 'ru';
      return def?.title?.[lang] ?? tx(t, `roles.${role}`, role);
    },
    [query.data, i18n.language, t],
  );
  return { definitions: query.data, roleTitle, loading: query.isLoading };
}
