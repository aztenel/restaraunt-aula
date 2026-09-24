/**
 * Права. Выдаются ролью, роль привязана к филиалу (или глобальная).
 * Матрица «роль -> права» живёт в модуле Identity; здесь только словарь прав,
 * чтобы любой модуль мог проверять доступ, не завися от Identity.
 */
export const Permission = {
  OrdersView: 'orders.view',
  OrdersManage: 'orders.manage',
  OrdersRefund: 'orders.refund',

  ReservationsView: 'reservations.view',
  ReservationsManage: 'reservations.manage',
  VenuesManage: 'venues.manage',

  BanquetsView: 'banquets.view',
  BanquetsManage: 'banquets.manage',
  BanquetsInvoice: 'banquets.invoice',

  MenuContent: 'menu.content',
  MenuPrices: 'menu.prices',
  MenuStopList: 'menu.stoplist',
  ContentManage: 'content.manage',
  DeliveryZonesManage: 'delivery_zones.manage',
  PromoCodesManage: 'promocodes.manage',

  PaymentsView: 'payments.view',
  PaymentsRefund: 'payments.refund',
  PaymentsManual: 'payments.manual',

  CertificatesView: 'certificates.view',
  CertificatesManage: 'certificates.manage',
  CertificatesRedeem: 'certificates.redeem',

  CustomersView: 'customers.view',
  CustomersManage: 'customers.manage',
  CustomersExport: 'customers.export',

  ReportsBranch: 'reports.branch',
  ReportsConsolidated: 'reports.consolidated',
  ReportsExport: 'reports.export',

  UsersManage: 'users.manage',
  BranchesManage: 'branches.manage',
  IntegrationsManage: 'integrations.manage',
  AuditView: 'audit.view',
  SystemJobs: 'system.jobs',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (ALL_PERMISSIONS as readonly string[]).includes(value);
}
