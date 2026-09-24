/**
 * Ключи TanStack Query. Корневые ключи разделов ('orders', 'reservations', 'banquets', 'system')
 * инвалидируются лентой событий (useAdminFeed) — модули-фичи должны начинать свои ключи с них:
 *   ['orders', 'list', params], ['orders', 'detail', id], ...
 */
export const queryKeys = {
  me: ['auth', 'me'] as const,
  branches: ['admin', 'branches'] as const,
  roles: ['admin', 'users', 'roles'] as const,
  users: (params: object) => ['admin', 'users', 'list', params] as const,
  legalEntities: ['admin', 'legal-entities'] as const,
  integrationCatalog: ['system', 'integrations', 'catalog'] as const,
  integrations: ['system', 'integrations', 'settings'] as const,
  auditLog: (params: object) => ['system', 'audit-log', params] as const,
  failedJobs: (params: object) => ['system', 'failed-jobs', params] as const,
  integrationLogs: (params: object) => ['system', 'integration-logs', params] as const,
  feedRecent: ['feed', 'recent'] as const,

  // Корни разделов, которые обновляются лентой событий.
  orders: ['orders'] as const,
  reservations: ['reservations'] as const,
  banquets: ['banquets'] as const,
  system: ['system'] as const,
};
