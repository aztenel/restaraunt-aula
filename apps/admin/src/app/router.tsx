/**
 * Маршруты админки. Разделы загружаются лениво (отдельные чанки), каждый охраняется правами
 * из navigation.tsx (хотя бы одно право хотя бы в одном филиале — как @RequirePermissions на API).
 */
import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router';
import { RequireAuth } from '@/shared/auth/RequireAuth';
import { RequirePermission } from '@/shared/auth/RequirePermission';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { NotFoundPage } from '@/features/common/NotFoundPage';
import { RouteError } from '@/features/common/RouteError';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AdminLayout } from './layout/AdminLayout';
import { sectionByKey, type SectionKey } from './navigation';

type Loader = () => Promise<ComponentType>;

const SECTION_PAGES: Record<Exclude<SectionKey, 'dashboard'>, Loader> = {
  orders: () => import('@/features/orders/OrdersPage').then((m) => m.OrdersPage),
  reservations: () => import('@/features/reservations/ReservationsPage').then((m) => m.ReservationsPage),
  banquets: () => import('@/features/banquets/BanquetsPage').then((m) => m.BanquetsPage),
  menu: () => import('@/features/menu/MenuPage').then((m) => m.MenuPage),
  deliveryZones: () => import('@/features/delivery-zones/DeliveryZonesPage').then((m) => m.DeliveryZonesPage),
  promocodes: () => import('@/features/promocodes/PromoCodesPage').then((m) => m.PromoCodesPage),
  venues: () => import('@/features/venues/VenuesPage').then((m) => m.VenuesPage),
  certificates: () => import('@/features/certificates/CertificatesPage').then((m) => m.CertificatesPage),
  customers: () => import('@/features/customers/CustomersPage').then((m) => m.CustomersPage),
  payments: () => import('@/features/payments/PaymentsPage').then((m) => m.PaymentsPage),
  reports: () => import('@/features/reports/ReportsPage').then((m) => m.ReportsPage),
  users: () => import('@/features/users/UsersPage').then((m) => m.UsersPage),
  branches: () => import('@/features/branches/BranchesPage').then((m) => m.BranchesPage),
  legalEntities: () => import('@/features/legal-entities/LegalEntitiesPage').then((m) => m.LegalEntitiesPage),
  integrations: () => import('@/features/integrations/IntegrationsPage').then((m) => m.IntegrationsPage),
  auditLog: () => import('@/features/audit/AuditLogPage').then((m) => m.AuditLogPage),
  system: () => import('@/features/system/SystemPage').then((m) => m.SystemPage),
};

function sectionRoute(key: Exclude<SectionKey, 'dashboard'>): RouteObject {
  const section = sectionByKey(key);
  return {
    path: `${section.path.slice(1)}/*`,
    lazy: async () => {
      const Page = await SECTION_PAGES[key]();
      return {
        Component: () => (
          <RequirePermission anyOf={section.anyOf}>
            <Page />
          </RequirePermission>
        ),
      };
    },
  };
}

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  {
    path: '/change-password',
    element: (
      <RequireAuth>
        <ChangePasswordPage />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <AdminLayout />
      </RequireAuth>
    ),
    errorElement: <RouteError />,
    children: [
      { index: true, element: <DashboardPage /> },
      ...(Object.keys(SECTION_PAGES) as Array<Exclude<SectionKey, 'dashboard'>>).map(sectionRoute),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
