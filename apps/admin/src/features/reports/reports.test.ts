import { describe, expect, it } from 'vitest';
import { Permission } from '@aula/api-client';
import {
  activeChannels,
  banquetFunnelRows,
  compactMoney,
  conversionFunnel,
  goalRows,
  hallLoadMatrix,
  loadStep,
  loadTextColor,
  moneyText,
  percent,
  revenueChartRows,
} from './chart-data';
import { detectPreset, monthsOf, periodDays, periodFromParams, periodIssue, presetPeriod, reportingToday } from './period';
import { canAccountingExport, canEditAggregators, reportScope, scopeBranchId } from './scope';
import type { ConversionReport, GoalsReport, HallLoadRow, RevenueDay } from './types';

// 30.09.2026 20:30 UTC — уже 1 октября в Алматы (UTC+5).
const LATE_EVENING_UTC = Date.parse('2026-09-30T20:30:00Z');
// 15.03.2026 10:00 UTC — 15 марта в Алматы.
const MID_MARCH = Date.parse('2026-03-15T10:00:00Z');

describe('отчётный период (Asia/Almaty)', () => {
  it('«сегодня» — по Алматы, а не по UTC', () => {
    expect(reportingToday(LATE_EVENING_UTC)).toBe('2026-10-01');
    expect(presetPeriod('today', LATE_EVENING_UTC)).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(presetPeriod('yesterday', LATE_EVENING_UTC)).toEqual({ from: '2026-09-30', to: '2026-09-30' });
  });

  it('7 и 30 дней включают сегодня', () => {
    expect(presetPeriod('last7', MID_MARCH)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(presetPeriod('last30', MID_MARCH)).toEqual({ from: '2026-02-14', to: '2026-03-15' });
    expect(periodDays(presetPeriod('last30', MID_MARCH))).toBe(30);
  });

  it('текущий и прошлый месяц (переход года и февраль)', () => {
    expect(presetPeriod('thisMonth', MID_MARCH)).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(presetPeriod('prevMonth', MID_MARCH)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetPeriod('prevMonth', Date.parse('2026-01-10T10:00:00Z'))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('быстрый период узнаётся по датам; свой — null', () => {
    expect(detectPreset({ from: '2026-03-09', to: '2026-03-15' }, MID_MARCH)).toBe('last7');
    expect(detectPreset({ from: '2026-03-02', to: '2026-03-15' }, MID_MARCH)).toBeNull();
  });

  it('проверка периода — как на сервере', () => {
    expect(periodIssue({ from: '2026-03-01', to: '2026-03-31' })).toBeNull();
    expect(periodIssue({ from: '2026-04-01', to: '2026-03-31' })).toBe('invalid_period');
    expect(periodIssue({ from: '2025-01-01', to: '2026-03-31' })).toBe('period_too_long');
    expect(periodIssue({ from: '2026-3-1', to: '2026-03-31' })).toBe('invalid_date');
  });

  it('период из адреса; неверный — последние 30 дней', () => {
    expect(periodFromParams(new URLSearchParams('from=2026-03-01&to=2026-03-10'), MID_MARCH)).toEqual({ from: '2026-03-01', to: '2026-03-10' });
    expect(periodFromParams(new URLSearchParams('from=2026-03-10&to=2026-03-01'), MID_MARCH)).toEqual(presetPeriod('last30', MID_MARCH));
    expect(monthsOf({ from: '2026-01-15', to: '2026-03-01' })).toEqual({ fromMonth: '2026-01', toMonth: '2026-03' });
  });
});

describe('область отчёта: филиал или сводный', () => {
  const B1 = 'b1';
  const B2 = 'b2';
  const manager = { globalPermissions: [], branchPermissions: { [B1]: [Permission.ReportsBranch] } };
  const owner = { globalPermissions: [Permission.ReportsBranch, Permission.ReportsConsolidated, Permission.ReportsExport], branchPermissions: {} };
  const consolidatedOnly = { globalPermissions: [Permission.ReportsConsolidated], branchPermissions: {} };

  it('управляющий: свой филиал — отчёт филиала, чужой — нет доступа', () => {
    expect(reportScope(manager, B1, [B1, B2])).toEqual({ kind: 'branch', branchId: B1 });
    expect(reportScope(manager, B2, [B1, B2])).toEqual({ kind: 'forbidden', canConsolidated: false });
  });

  it('«Все филиалы» без сводного права — выбрать свой филиал', () => {
    expect(reportScope(manager, null, [B1, B2])).toEqual({ kind: 'choose_branch', branchIds: [B1] });
  });

  it('собственник/финансы: «Все филиалы» — сводный, филиал — отчёт филиала', () => {
    expect(reportScope(owner, null, [B1, B2])).toEqual({ kind: 'consolidated' });
    expect(reportScope(owner, B2, [B1, B2])).toEqual({ kind: 'branch', branchId: B2 });
    expect(scopeBranchId({ kind: 'consolidated' })).toBeNull();
    expect(scopeBranchId({ kind: 'branch', branchId: B2 })).toBe(B2);
    expect(scopeBranchId({ kind: 'choose_branch', branchIds: [] })).toBeUndefined();
  });

  it('только сводное право: филиал недоступен, но можно перейти к сводному', () => {
    expect(reportScope(consolidatedOnly, B1, [B1])).toEqual({ kind: 'forbidden', canConsolidated: true });
  });

  it('выгрузка в учёт и ввод итогов агрегаторов', () => {
    expect(canAccountingExport(owner, null)).toBe(true);
    expect(canAccountingExport(manager, B1)).toBe(false);
    expect(canEditAggregators(manager, B1)).toBe(true);
    expect(canEditAggregators(manager, B2)).toBe(false);
    expect(canEditAggregators(owner, null)).toBe(false);
  });
});

describe('данные графиков: тиыны без пересчёта', () => {
  const money = (amount: number) => ({ amount, currency: 'KZT' as const });
  const day = (date: string, delivery: number, pickup: number, refunds = 0): RevenueDay => ({
    date,
    delivery: money(delivery),
    pickup: money(pickup),
    banquet: money(0),
    certificate: money(0),
    refunds: money(refunds),
    total: money(delivery + pickup),
  });

  it('дни → строки графика в тиынах (целые, как от сервера)', () => {
    const rows = revenueChartRows([day('2026-09-05', 1_250_050, 300_000, -50_000)]);
    expect(rows).toEqual([
      { date: '2026-09-05', label: '05.09', delivery: 1_250_050, pickup: 300_000, banquet: 0, certificate: 0, refunds: -50_000, total: 1_550_050 },
    ]);
    expect(activeChannels(rows)).toEqual(['delivery', 'pickup']);
  });

  it('подписи: тиыны → ₸ только при выводе', () => {
    expect(moneyText(1_250_050, 'ru')).toBe('12 500,50 ₸');
    expect(compactMoney(125_000_000, 'ru')).toMatch(/^1,3\s?млн ₸$/);
    expect(compactMoney(0, 'ru')).toBe('0 ₸');
  });

  it('доли: null — «—», иначе проценты', () => {
    expect(percent(null, 'ru')).toBe('—');
    expect(percent(0.1234, 'ru')).toMatch(/^12,3\s?%$/);
    expect(percent(1, 'ru')).toMatch(/^100\s?%$/);
  });

  it('воронка конверсии: доля от первой и предыдущей ступени', () => {
    const report = {
      sessions: 200,
      menuViewSessions: 150,
      dishViewSessions: 100,
      addToCartSessions: 50,
      checkoutSessions: 25,
      orderedSessions: 10,
    } as ConversionReport;
    const rows = conversionFunnel(report);
    expect(rows[0]).toEqual({ key: 'sessions', value: 200, ofFirst: 1, ofPrevious: null });
    expect(rows[5]).toEqual({ key: 'orderedSessions', value: 10, ofFirst: 0.05, ofPrevious: 0.4 });
    expect(conversionFunnel({ ...report, sessions: 0, menuViewSessions: 0 })[1]).toMatchObject({ ofFirst: null, ofPrevious: null });
  });

  it('воронка банкетов — стадии по порядку, отсутствующие — нули', () => {
    const rows = banquetFunnelRows([
      { status: 'held', reached: 2, current: 2 },
      { status: 'new', reached: 10, current: 3 },
    ] as never);
    expect(rows.map((r) => r.key)).toEqual(['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held']);
    expect(rows[0]).toMatchObject({ value: 10, current: 3, ofFirst: 1 });
    expect(rows[1]).toMatchObject({ value: 0, ofPrevious: 0 });
    expect(rows[5]).toMatchObject({ value: 2, ofFirst: 0.2, ofPrevious: null });
  });

  it('загрузка залов: матрица день недели × тип места и шкала одного оттенка', () => {
    const row = (weekday: HallLoadRow['weekday'], code: string, load: number | null) =>
      ({ weekday, venueTypeCode: code, venueTypeName: { ru: code }, load }) as HallLoadRow;
    const matrix = hallLoadMatrix([row('mon', 'table', 0.5), row('tue', 'vip', 0.9), row('mon', 'vip', null)]);
    expect(matrix.types.map((t) => t.code)).toEqual(['table', 'vip']);
    expect(matrix.cells.mon.table?.load).toBe(0.5);
    expect(matrix.cells.sun).toEqual({});
    expect(loadStep(null)).toBeNull();
    expect(loadStep(0)).toBe(0);
    expect(loadStep(1)).toBe(6);
    expect(loadStep(1.4)).toBe(6);
    expect(loadTextColor(loadStep(0.9))).toBe('#ffffff');
    expect(loadTextColor(loadStep(0.1))).toBe('#1f1f1f');
  });

  it('цели ТЗ: 95% ответов за 30 минут, 0 потерь и накладок, дневные отчёты автоматически', () => {
    const goals = {
      ownChannelShare: null,
      banquetAnsweredWithinSlaShare: 0.9,
      lostBanquetRequests: 0,
      overbookings: 1,
      dailyReportsExpected: 7,
      dailyReportsGenerated: 7,
    } as GoalsReport;
    expect(goalRows(goals).map((g) => [g.key, g.status])).toEqual([
      ['ownChannel', 'no_data'],
      ['banquetSla', 'not_met'],
      ['lostBanquets', 'met'],
      ['overbookings', 'not_met'],
      ['dailyReports', 'met'],
    ]);
  });
});
