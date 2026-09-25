/**
 * Отчёты (reports.branch / reports.consolidated): период — быстрые периоды или свои даты (Asia/Almaty),
 * филиал — из переключателя в шапке («Все филиалы» — сводный отчёт, только с reports.consolidated).
 * Каждый отчёт — отдельная вкладка с выгрузкой XLSX; выгрузка в учёт (1С) — reports.export.
 */
import { ShopOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Empty, Result, Segmented, Space, Tabs } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { useCan } from '@/shared/auth/useCan';
import { ALL_BRANCHES, useBranch } from '@/shared/branch/BranchProvider';
import { dayjs } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { detectPreset, PERIOD_PRESETS, periodFromParams, periodIssue, presetPeriod, reportingToday, type Period, type PeriodPreset } from './period';
import { ReportContext, type ReportContextValue } from './report-ui';
import { reportScope, scopeBranchId } from './scope';
import { AccountingTab } from './tabs/AccountingTab';
import { DailyTab } from './tabs/DailyTab';
import { DashboardTab } from './tabs/DashboardTab';
import { GoalsTab } from './tabs/GoalsTab';
import { CertificatesTab, PaymentsTab } from './tabs/MoneyTabs';
import { CancelledOrdersTab, ConversionTab, TopDishesTab } from './tabs/OrdersTabs';
import { AverageCheckTab, OwnChannelTab, RevenueTab } from './tabs/SalesTabs';
import { BanquetFunnelTab, HallLoadTab } from './tabs/VenueTabs';

const TABS = [
  'dashboard',
  'revenue',
  'average-check',
  'conversion',
  'top-dishes',
  'hall-load',
  'banquet-funnel',
  'cancelled-orders',
  'payments',
  'certificates',
  'own-channel',
  'goals',
  'daily',
  'accounting',
] as const;
type ReportTab = (typeof TABS)[number];

/** Вкладка → ключ подписи (reports.tabs.*). */
const TAB_LABELS = {
  dashboard: 'dashboard',
  revenue: 'revenue',
  'average-check': 'averageCheck',
  conversion: 'conversion',
  'top-dishes': 'topDishes',
  'hall-load': 'hallLoad',
  'banquet-funnel': 'banquetFunnel',
  'cancelled-orders': 'cancelledOrders',
  payments: 'payments',
  certificates: 'certificates',
  'own-channel': 'ownChannel',
  goals: 'goals',
  daily: 'daily',
  accounting: 'accounting',
} as const satisfies Record<ReportTab, string>;

/** Вкладки без выбора периода в шапке (свой период или дата внутри). */
const NO_PERIOD_TABS: ReportTab[] = ['dashboard', 'daily'];

export function ReportsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { me } = useAuth();
  const { canSomewhere } = useCan();
  const { branches, selectedBranchId, setSelection, branchName } = useBranch();
  const period = periodFromParams(params);
  const segment = location.pathname.replace(/^\/reports\/?/, '').split('/')[0] as ReportTab | '';
  const activeTab: ReportTab = (TABS as readonly string[]).includes(segment) ? (segment as ReportTab) : 'dashboard';
  const canExport = canSomewhere(Permission.ReportsExport);
  const tabs = TABS.filter((tab) => tab !== 'accounting' || canExport);
  const scope = reportScope(
    me,
    selectedBranchId,
    branches.map((b) => b.id),
  );
  const branchId = scopeBranchId(scope);

  const context = useMemo<ReportContextValue | null>(
    () =>
      branchId === undefined
        ? null
        : {
            params: { from: period.from, to: period.to, branchId },
            scopeLabel: branchId ? t('reports.scope.branch', { name: branchName(branchId) }) : t('reports.scope.consolidated'),
          },
    [branchId, period.from, period.to, t, branchName],
  );

  const setPeriod = (next: Period) =>
    setParams(
      (prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('from', next.from);
        copy.set('to', next.to);
        return copy;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        subtitle={t('sections.reports')}
        extra={NO_PERIOD_TABS.includes(activeTab) ? null : <PeriodPicker period={period} onChange={setPeriod} />}
      />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => navigate({ pathname: `/reports/${key}`, search: location.search })}
        items={tabs.map((key) => ({ key, label: t(`reports.tabs.${TAB_LABELS[key]}`) }))}
        style={{ marginBottom: 8 }}
      />
      {scope.kind === 'choose_branch' ? (
        <Card>
          <Result
            icon={<ShopOutlined style={{ color: '#a5774f' }} />}
            title={t('reports.scope.chooseTitle')}
            subTitle={t('reports.scope.chooseText')}
            extra={
              scope.branchIds.length > 0 ? (
                <BranchSelect size="large" style={{ minWidth: 280 }} onlyIds={scope.branchIds} onChange={(id) => id && setSelection(id)} />
              ) : (
                <Empty description={t('reports.scope.none')} />
              )
            }
          />
        </Card>
      ) : null}
      {scope.kind === 'forbidden' ? (
        <Card>
          <Result
            status="403"
            title={t('reports.scope.forbiddenTitle')}
            subTitle={t('reports.scope.forbiddenText')}
            extra={
              scope.canConsolidated ? (
                <Button type="primary" onClick={() => setSelection(ALL_BRANCHES)}>
                  {t('reports.scope.toConsolidated')}
                </Button>
              ) : null
            }
          />
        </Card>
      ) : null}
      {context ? (
        <ReportContext.Provider value={context}>
          <Routes>
            <Route index element={<Navigate to={{ pathname: 'dashboard', search: location.search }} replace />} />
            <Route path="dashboard" element={<DashboardTab />} />
            <Route path="revenue" element={<RevenueTab />} />
            <Route path="average-check" element={<AverageCheckTab />} />
            <Route path="conversion" element={<ConversionTab />} />
            <Route path="top-dishes" element={<TopDishesTab />} />
            <Route path="hall-load" element={<HallLoadTab />} />
            <Route path="banquet-funnel" element={<BanquetFunnelTab />} />
            <Route path="cancelled-orders" element={<CancelledOrdersTab />} />
            <Route path="payments" element={<PaymentsTab />} />
            <Route path="certificates" element={<CertificatesTab />} />
            <Route path="own-channel" element={<OwnChannelTab />} />
            <Route path="goals" element={<GoalsTab />} />
            <Route path="daily" element={<DailyTab />} />
            <Route path="accounting" element={canExport ? <AccountingTab /> : <NotFoundPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </ReportContext.Provider>
      ) : null}
    </>
  );
}

/** Период отчёта: быстрые периоды и свои даты (не длиннее 366 дней, не позже сегодня в Алматы). */
function PeriodPicker({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const preset = detectPreset(period);
  const today = reportingToday();
  return (
    <Space wrap>
      <Segmented<PeriodPreset | 'custom'>
        value={preset ?? 'custom'}
        onChange={(value) => {
          if (value !== 'custom') onChange(presetPeriod(value));
        }}
        options={[
          ...PERIOD_PRESETS.map((value) => ({ value, label: t(`reports.period.presets.${value}`) })),
          { value: 'custom' as const, label: t('reports.period.presets.custom'), disabled: true },
        ]}
      />
      <DatePicker.RangePicker
        value={[dayjs(period.from), dayjs(period.to)]}
        format="DD.MM.YYYY"
        allowClear={false}
        disabledDate={(d) => d.format('YYYY-MM-DD') > today}
        onChange={(range) => {
          if (!range?.[0] || !range[1]) return;
          const next = { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') };
          const issue = periodIssue(next);
          if (issue) void message.warning(t(`reports.period.issues.${issue}`));
          else onChange(next);
        }}
        aria-label={t('reports.period.label')}
      />
    </Space>
  );
}
