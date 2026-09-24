import type { ReactNode } from 'react';
import type { Permission } from '@aula/api-client';
import { Forbidden } from '../ui/Forbidden';
import { useCan } from './useCan';

/**
 * Охрана маршрута/блока: хотя бы одно из прав хотя бы в одном филиале
 * (как @RequirePermissions на бэкенде). anyOf пустой/не задан — достаточно входа.
 */
export function RequirePermission({
  anyOf,
  children,
  fallback,
}: {
  anyOf?: readonly Permission[] | null;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { canAny } = useCan();
  if (anyOf && anyOf.length > 0 && !canAny(anyOf)) return <>{fallback ?? <Forbidden />}</>;
  return <>{children}</>;
}
