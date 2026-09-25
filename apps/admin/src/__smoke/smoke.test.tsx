// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import { ReportContext } from '@/features/reports/report-ui';

const money = (amount: number) => ({ amount, currency: 'KZT' as const });
const amounts = { delivery: money(100000), pickup: money(50000), banquet: money(0), certificate: money(20000), refunds: money(-1000), total: money(170000) };

vi.mock('@/shared/branch/BranchProvider', () => ({
  ALL_BRANCHES: 'all',
  useBranch: () => ({ branches: [], selectedBranchId: 'b1', branchName: () => 'Филиал 1', getBranch: () => ({ id: 'b1', slug: 'gl', timezone: 'Asia/Almaty' }), setSelection: () => undefined }),
}));
vi.mock('@/shared/auth/AuthProvider', () => ({
  useAuth: () => ({ me: { globalPermissions: ['reports.branch', 'reports.consolidated', 'reports.export', 'integrations.manage'], branchPermissions: {} } }),
}));
vi.mock('@/features/reports/api', async (orig) => {
  const actual = await orig<typeof import('@/features/reports/api')>();
  return {
    ...actual,
    reportsApi: {
      ...actual.reportsApi,
      revenue: async () => ({ from: '2026-09-01', to: '2026-09-02', branchId: 'b1', days: [{ date: '2026-09-01', ...amounts }, { date: '2026-09-02', ...amounts }], totals: amounts, counts: { delivery: 3, pickup: 1, banquet: 0, certificate: 1 }, byBranch: [] }),
      hallLoad: async () => ({ from: '2026-09-01', to: '2026-09-02', branchId: 'b1', rows: [{ weekday: 'mon', venueTypeCode: 'table', venueTypeName: { ru: 'Стол' }, venues: 3, openMinutes: 600, bookedMinutes: 300, openHours: 10, bookedHours: 5, load: 0.5, reservations: 4, guests: 10 }], weekdays: [], overbookingCount: 0, overbookings: [] }),
      goals: async () => ({ from: '2026-09-01', to: '2026-09-02', branchId: 'b1', ownChannelShare: 0.4, ownOrders: 10, aggregatorOrders: 15, banquetAnsweredWithinSlaShare: 0.96, banquetRequests: 5, lostBanquetRequests: 0, overbookings: 0, dailyReportsExpected: 1, dailyReportsGenerated: 1 }),
      banquetFunnel: async () => ({ from: '2026-09-01', to: '2026-09-02', branchId: 'b1', total: 10, stages: [{ status: 'new', reached: 10, current: 2 }, { status: 'held', reached: 3, current: 3 }], held: 3, heldTotal: money(900000), conversion: 0.3, answerDue: 9, answeredWithinSla: 8, answeredWithinSlaShare: 0.8889, averageFirstResponseMinutes: 12, medianFirstResponseMinutes: 9, unansweredOverdue: 1, cancelled: 2, cancelledBeforeAgreement: 1, lost: 2, cancelReasons: [{ reason: 'Дорого', count: 1 }], slaMinutes: 30 }),
      aggregatorVolumes: async () => [],
      ownChannel: async () => ({ from: '2026-09-01', to: '2026-09-02', branchId: 'b1', months: [], totals: { webOrders: 1, adminOrders: 1, ownOrders: 2, ownRevenue: money(100), aggregatorOrders: null, aggregatorRevenue: null, ownShare: null } }),
    },
  };
});

beforeAll(async () => {
  window.matchMedia ??= ((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  const gcs = window.getComputedStyle.bind(window);
  window.getComputedStyle = (el: Element) => gcs(el);
  await i18n.changeLanguage('ru');
});
afterEach(() => cleanup());

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <App>
          <MemoryRouter>
            <ReportContext.Provider value={{ params: { from: '2026-09-01', to: '2026-09-02', branchId: 'b1' }, scopeLabel: 'Филиал: 1' }}>{node}</ReportContext.Provider>
          </MemoryRouter>
        </App>
      </I18nextProvider>
    </QueryClientProvider>,
  );
}

describe('smoke', () => {
  it('revenue', async () => {
    const { RevenueTab } = await import('@/features/reports/tabs/SalesTabs');
    wrap(<RevenueTab />);
    await waitFor(() => expect(screen.getAllByText(/1\s700\s₸/).length).toBeGreaterThan(0));
  });
  it('hall load', async () => {
    const { HallLoadTab } = await import('@/features/reports/tabs/VenueTabs');
    wrap(<HallLoadTab />);
    await waitFor(() => expect(screen.getByText('Стол')).toBeTruthy());
  });
  it('goals', async () => {
    const { GoalsTab } = await import('@/features/reports/tabs/GoalsTab');
    wrap(<GoalsTab />);
    await waitFor(() => expect(screen.getAllByText('Достигнута').length).toBeGreaterThan(0));
  });
  it('banquets', async () => {
    const { BanquetFunnelTab } = await import('@/features/reports/tabs/VenueTabs');
    wrap(<BanquetFunnelTab />);
    await waitFor(() => expect(screen.getByText('Дорого')).toBeTruthy());
  });
  it('own channel', async () => {
    const { OwnChannelTab } = await import('@/features/reports/tabs/SalesTabs');
    wrap(<OwnChannelTab />);
    await waitFor(() => expect(screen.getByText('Итоги агрегаторов по месяцам')).toBeTruthy());
  });
});
