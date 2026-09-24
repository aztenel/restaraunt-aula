import { ALL_PERMISSIONS, Permission } from '../../../shared/kernel/permissions';
import { StaffRole } from '../public/staff-directory';

/**
 * Матрица ролей из ТЗ. Роль привязана к филиалу (scope=branch) или глобальная (scope=global).
 * Глобальные роли видят все филиалы.
 */
export interface RoleDefinition {
  role: StaffRole;
  scope: 'branch' | 'global';
  title: { ru: string; kk: string };
  permissions: readonly Permission[];
}

const P = Permission;

export const ROLE_DEFINITIONS: Record<StaffRole, RoleDefinition> = {
  // Видеть и вести заказы и брони своего филиала, менять статусы. Проверка и погашение сертификатов на точке.
  branch_operator: {
    role: 'branch_operator',
    scope: 'branch',
    title: { ru: 'Оператор точки', kk: 'Нүкте операторы' },
    permissions: [P.OrdersView, P.OrdersManage, P.ReservationsView, P.ReservationsManage, P.CertificatesRedeem, P.CustomersView],
  },
  // Вести банкетные заявки, формировать сметы, выставлять счета — по всем филиалам.
  banquet_manager: {
    role: 'banquet_manager',
    scope: 'global',
    title: { ru: 'Банкетный менеджер', kk: 'Банкет менеджері' },
    permissions: [
      P.BanquetsView,
      P.BanquetsManage,
      P.BanquetsInvoice,
      P.ReservationsView,
      P.CustomersView,
      P.CustomersManage,
      P.PaymentsView,
    ],
  },
  // Всё по своему филиалу: заказы, брони, залы, меню филиала (цены) и стоп-лист, зоны, промокоды, отчёты филиала.
  branch_manager: {
    role: 'branch_manager',
    scope: 'branch',
    title: { ru: 'Управляющий филиалом', kk: 'Филиал басқарушысы' },
    permissions: [
      P.OrdersView,
      P.OrdersManage,
      P.OrdersRefund,
      P.ReservationsView,
      P.ReservationsManage,
      P.VenuesManage,
      P.BanquetsView,
      P.MenuPrices,
      P.MenuStopList,
      P.DeliveryZonesManage,
      P.PromoCodesManage,
      P.PaymentsView,
      P.CertificatesView,
      P.CertificatesRedeem,
      P.CustomersView,
      P.ReportsBranch,
    ],
  },
  // Меню, блюда, категории, акции, тексты, баннеры — по всем филиалам.
  content_manager: {
    role: 'content_manager',
    scope: 'global',
    title: { ru: 'Контент-менеджер', kk: 'Контент-менеджер' },
    permissions: [P.MenuContent, P.MenuPrices, P.ContentManage, P.PromoCodesManage],
  },
  // Оплаты, возвраты, выгрузки, отчёты — без доступа к контенту.
  finance: {
    role: 'finance',
    scope: 'global',
    title: { ru: 'Финансы', kk: 'Қаржы' },
    permissions: [
      P.OrdersView,
      P.OrdersRefund,
      P.BanquetsView,
      P.BanquetsInvoice,
      P.PaymentsView,
      P.PaymentsRefund,
      P.PaymentsManual,
      P.CertificatesView,
      P.ReportsBranch,
      P.ReportsConsolidated,
      P.ReportsExport,
    ],
  },
  // Всё, включая сводные отчёты и управление пользователями.
  owner: {
    role: 'owner',
    scope: 'global',
    title: { ru: 'Собственник', kk: 'Иесі' },
    permissions: ALL_PERMISSIONS,
  },
  // Пользователи, роли, настройки интеграций, журнал действий.
  sysadmin: {
    role: 'sysadmin',
    scope: 'global',
    title: { ru: 'Администратор системы', kk: 'Жүйе әкімшісі' },
    permissions: [P.UsersManage, P.BranchesManage, P.IntegrationsManage, P.AuditView, P.SystemJobs],
  },
};

export const STAFF_ROLES = Object.keys(ROLE_DEFINITIONS) as StaffRole[];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (STAFF_ROLES as string[]).includes(value);
}

export interface RoleAssignment {
  role: StaffRole;
  branchId: string | null;
}

/** Сводит назначения ролей в права: глобальные + по филиалам. */
export function resolvePermissions(assignments: readonly RoleAssignment[]): {
  global: Permission[];
  byBranch: Record<string, Permission[]>;
} {
  const global = new Set<Permission>();
  const byBranch = new Map<string, Set<Permission>>();
  for (const a of assignments) {
    const def = ROLE_DEFINITIONS[a.role];
    if (!def) continue;
    if (def.scope === 'global') {
      def.permissions.forEach((p) => global.add(p));
    } else if (a.branchId) {
      const set = byBranch.get(a.branchId) ?? new Set<Permission>();
      def.permissions.forEach((p) => set.add(p));
      byBranch.set(a.branchId, set);
    }
  }
  return {
    global: [...global].sort(),
    byBranch: Object.fromEntries([...byBranch.entries()].map(([b, s]) => [b, [...s].sort()])),
  };
}
