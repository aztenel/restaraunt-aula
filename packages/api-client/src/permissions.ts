/**
 * Словарь прав — контракт API (строки в MeDto.globalPermissions / branchPermissions).
 * Зеркало apps/api/src/shared/kernel/permissions.ts; при добавлении права на бэкенде — добавить здесь.
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
