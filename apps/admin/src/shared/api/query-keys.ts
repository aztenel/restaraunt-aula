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

  // Каталог (меню) и контент витрины.
  catalog: ['catalog'] as const,
  categories: ['catalog', 'categories'] as const,
  dishes: ['catalog', 'dishes'] as const,
  dishList: (params: object) => ['catalog', 'dishes', 'list', params] as const,
  dish: (id: string) => ['catalog', 'dishes', 'detail', id] as const,
  modifierGroups: ['catalog', 'modifier-groups'] as const,
  allergens: ['catalog', 'allergens'] as const,
  translations: (params: object) => ['catalog', 'translations', params] as const,
  /** Меню филиала: ['catalog', 'branch-menu', branchId, params]; инвалидировать — по префиксу с branchId. */
  branchMenu: (branchId: string) => ['catalog', 'branch-menu', branchId] as const,
  branchMenuList: (branchId: string, params: object) => ['catalog', 'branch-menu', branchId, 'list', params] as const,
  /** Всё меню филиала (все страницы) — стоп-лист на планшете и массовое изменение цен. */
  branchMenuAll: (branchId: string) => ['catalog', 'branch-menu', branchId, 'all'] as const,
  stopList: (branchId: string) => ['catalog', 'branch-menu', branchId, 'stop-list'] as const,
  content: ['content'] as const,
  banners: ['content', 'banners'] as const,
  bannerList: (params: object) => ['content', 'banners', params] as const,
  promotions: ['content', 'promotions'] as const,
  pages: ['content', 'pages'] as const,
  page: (id: string) => ['content', 'pages', id] as const,

  // Корни разделов, которые обновляются лентой событий.
  orders: ['orders'] as const,
  reservations: ['reservations'] as const,
  banquets: ['banquets'] as const,
  system: ['system'] as const,
};
