/**
 * Разделы админки: путь, иконка, права (хотя бы одно — хотя бы в одном филиале).
 * Меню слева показывает только доступные разделы; маршруты охраняются теми же правами.
 */
import {
  ApiOutlined,
  AuditOutlined,
  BankOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CrownOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  GiftOutlined,
  HomeOutlined,
  ReadOutlined,
  ShopOutlined,
  ShoppingCartOutlined,
  TagsOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { Permission } from '@aula/api-client';
import type { FeedStream } from '@/shared/feed/types';

export type SectionKey =
  | 'dashboard'
  | 'orders'
  | 'reservations'
  | 'banquets'
  | 'menu'
  | 'deliveryZones'
  | 'promocodes'
  | 'venues'
  | 'certificates'
  | 'customers'
  | 'payments'
  | 'reports'
  | 'users'
  | 'branches'
  | 'legalEntities'
  | 'integrations'
  | 'auditLog'
  | 'system';

export type SectionGroup = 'operations' | 'catalog' | 'finance' | 'admin';

export interface SectionDef {
  key: SectionKey;
  path: string;
  icon: ReactNode;
  /** null — доступно любому сотруднику. */
  anyOf: Permission[] | null;
  group: SectionGroup;
  /** Очередь ленты событий (счётчик непрочитанного в меню). */
  stream?: FeedStream;
}

const P = Permission;

export const SECTIONS: SectionDef[] = [
  { key: 'dashboard', path: '/', icon: <DashboardOutlined />, anyOf: null, group: 'operations' },
  { key: 'orders', path: '/orders', icon: <ShoppingCartOutlined />, anyOf: [P.OrdersView], group: 'operations', stream: 'orders' },
  {
    key: 'reservations',
    path: '/reservations',
    icon: <CalendarOutlined />,
    anyOf: [P.ReservationsView],
    group: 'operations',
    stream: 'reservations',
  },
  { key: 'banquets', path: '/banquets', icon: <CrownOutlined />, anyOf: [P.BanquetsView], group: 'operations', stream: 'banquets' },
  { key: 'menu', path: '/menu', icon: <ReadOutlined />, anyOf: [P.MenuContent, P.MenuPrices, P.MenuStopList], group: 'catalog' },
  { key: 'deliveryZones', path: '/delivery-zones', icon: <EnvironmentOutlined />, anyOf: [P.DeliveryZonesManage], group: 'catalog' },
  { key: 'promocodes', path: '/promocodes', icon: <TagsOutlined />, anyOf: [P.PromoCodesManage], group: 'catalog' },
  { key: 'venues', path: '/venues', icon: <HomeOutlined />, anyOf: [P.VenuesManage], group: 'catalog' },
  {
    key: 'certificates',
    path: '/certificates',
    icon: <GiftOutlined />,
    anyOf: [P.CertificatesView, P.CertificatesManage, P.CertificatesRedeem],
    group: 'finance',
  },
  { key: 'customers', path: '/customers', icon: <TeamOutlined />, anyOf: [P.CustomersView], group: 'finance' },
  { key: 'payments', path: '/payments', icon: <WalletOutlined />, anyOf: [P.PaymentsView], group: 'finance' },
  { key: 'reports', path: '/reports', icon: <BarChartOutlined />, anyOf: [P.ReportsBranch, P.ReportsConsolidated], group: 'finance' },
  { key: 'users', path: '/users', icon: <UserOutlined />, anyOf: [P.UsersManage], group: 'admin' },
  { key: 'branches', path: '/branches', icon: <ShopOutlined />, anyOf: [P.BranchesManage], group: 'admin' },
  { key: 'legalEntities', path: '/legal-entities', icon: <BankOutlined />, anyOf: [P.BranchesManage, P.BanquetsInvoice], group: 'admin' },
  { key: 'integrations', path: '/integrations', icon: <ApiOutlined />, anyOf: [P.IntegrationsManage], group: 'admin' },
  { key: 'auditLog', path: '/audit-log', icon: <AuditOutlined />, anyOf: [P.AuditView], group: 'admin' },
  { key: 'system', path: '/system', icon: <ToolOutlined />, anyOf: [P.SystemJobs, P.IntegrationsManage], group: 'admin' },
];

export const SECTION_GROUPS: SectionGroup[] = ['operations', 'catalog', 'finance', 'admin'];

export function sectionByKey(key: SectionKey): SectionDef {
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) throw new Error(`Unknown section ${key}`);
  return section;
}

/** Раздел, к которому относится путь (для подсветки пункта меню). */
export function sectionForPath(pathname: string): SectionDef | undefined {
  return [...SECTIONS]
    .sort((a, b) => b.path.length - a.path.length)
    .find((s) => (s.path === '/' ? pathname === '/' : pathname === s.path || pathname.startsWith(`${s.path}/`)));
}
