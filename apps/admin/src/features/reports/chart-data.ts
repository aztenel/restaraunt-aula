/**
 * Данные для графиков и таблиц отчётов — чистые функции. Суммы остаются в тиынах (целые числа
 * от сервера): графики строятся по тиынам, а подписи осей и подсказки форматируются formatMoney /
 * компактной записью только при выводе. Ничего не пересчитывается — доли и итоги считает сервер;
 * здесь только раскладка для отображения (проценты от первой стадии, матрица дней недели).
 */
import { formatMoney, type Money } from '@aula/api-client';
import { shortDate } from './period';
import {
  BANQUET_STAGES,
  SALES_CHANNELS,
  WEEKDAYS,
  type BanquetStage,
  type ConversionReport,
  type GoalsReport,
  type HallLoadRow,
  type RevenueDay,
  type SalesChannel,
  type Weekday,
} from './types';

// ---------------------------------------------------------------- форматирование

function intlLocale(locale: string): string {
  return locale.startsWith('kk') ? 'kk-KZ' : 'ru-RU';
}

/** Компактная подпись оси: 125 000 000 тиынов → «1,3 млн ₸». Только отображение. */
export function compactMoney(tiyn: number, locale: string): string {
  const tenge = Math.round(tiyn / 100);
  const text = new Intl.NumberFormat(intlLocale(locale), { notation: 'compact', maximumFractionDigits: 1 }).format(tenge);
  return `${text} ₸`;
}

/** Сумма в тиынах → «2 500 ₸» (подсказки и таблицы). */
export function moneyText(tiyn: number, locale: string): string {
  return formatMoney({ amount: tiyn, currency: 'KZT' }, locale);
}

/** Доля 0..1 от сервера → «12,3 %»; null (знаменатель 0) → «—». */
export function percent(ratio: number | null | undefined, locale: string, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(intlLocale(locale), { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(ratio);
}

export function amountOf(money: Money | null | undefined): number {
  return money?.amount ?? 0;
}

// ---------------------------------------------------------------- выручка по дням и каналам

export interface RevenueChartRow {
  date: string;
  /** '05.09' */
  label: string;
  delivery: number;
  pickup: number;
  banquet: number;
  certificate: number;
  /** Возвраты дня (≤ 0, уже учтены в каналах) — для подсказки и таблицы. */
  refunds: number;
  total: number;
}

/** Дни отчёта → строки графика (тиыны по каналам, нетто — как отдал сервер). */
export function revenueChartRows(days: readonly RevenueDay[]): RevenueChartRow[] {
  return days.map((day) => ({
    date: day.date,
    label: shortDate(day.date),
    delivery: amountOf(day.delivery),
    pickup: amountOf(day.pickup),
    banquet: amountOf(day.banquet),
    certificate: amountOf(day.certificate),
    refunds: amountOf(day.refunds),
    total: amountOf(day.total),
  }));
}

/** Каналы, у которых за период есть ненулевые суммы (пустые каналы не засоряют легенду). */
export function activeChannels(rows: readonly RevenueChartRow[]): SalesChannel[] {
  return SALES_CHANNELS.filter((channel) => rows.some((row) => row[channel] !== 0));
}

// ---------------------------------------------------------------- конверсия витрины

export type ConversionStep = 'sessions' | 'menuViewSessions' | 'dishViewSessions' | 'addToCartSessions' | 'checkoutSessions' | 'orderedSessions';
export const CONVERSION_STEPS: ConversionStep[] = [
  'sessions',
  'menuViewSessions',
  'dishViewSessions',
  'addToCartSessions',
  'checkoutSessions',
  'orderedSessions',
];

export interface FunnelRow<K extends string> {
  key: K;
  value: number;
  /** Доля от первой ступени (0..1); null — первая ступень пуста. */
  ofFirst: number | null;
  /** Доля от предыдущей ступени; null — для первой или пустой предыдущей. */
  ofPrevious: number | null;
}

function funnel<K extends string>(steps: ReadonlyArray<{ key: K; value: number }>): Array<FunnelRow<K>> {
  const first = steps[0]?.value ?? 0;
  return steps.map((step, index) => {
    const previous = index > 0 ? steps[index - 1]!.value : null;
    return {
      key: step.key,
      value: step.value,
      ofFirst: first > 0 ? step.value / first : null,
      ofPrevious: previous !== null && previous > 0 ? step.value / previous : null,
    };
  });
}

export function conversionFunnel(report: ConversionReport): Array<FunnelRow<ConversionStep>> {
  return funnel(CONVERSION_STEPS.map((key) => ({ key, value: report[key] })));
}

/** Воронка банкетов: сколько заявок дошло до каждой стадии (reached) в порядке стадий. */
export function banquetFunnelRows(stages: readonly BanquetStage[]): Array<FunnelRow<(typeof BANQUET_STAGES)[number]> & { current: number }> {
  const byStatus = new Map(stages.map((s) => [s.status, s]));
  const rows = funnel(BANQUET_STAGES.map((key) => ({ key, value: byStatus.get(key)?.reached ?? 0 })));
  return rows.map((row) => ({ ...row, current: byStatus.get(row.key)?.current ?? 0 }));
}

// ---------------------------------------------------------------- загрузка залов (тепловая карта)

export interface HallLoadMatrix {
  types: Array<{ code: string; name: HallLoadRow['venueTypeName'] }>;
  /** weekday → код типа места → строка отчёта. */
  cells: Record<Weekday, Record<string, HallLoadRow>>;
}

export function hallLoadMatrix(rows: readonly HallLoadRow[]): HallLoadMatrix {
  const types: HallLoadMatrix['types'] = [];
  const cells = Object.fromEntries(WEEKDAYS.map((d) => [d, {}])) as HallLoadMatrix['cells'];
  for (const row of rows) {
    if (!types.some((t) => t.code === row.venueTypeCode)) types.push({ code: row.venueTypeCode, name: row.venueTypeName });
    cells[row.weekday][row.venueTypeCode] = row;
  }
  return { types, cells };
}

/** Последовательная шкала одного оттенка (синий, от светлого к тёмному) — загрузка 0..1. */
export const LOAD_RAMP = ['#f2f7fd', '#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95'] as const;

/** Ступень шкалы для доли загрузки; null (нет часов работы) — нейтральная клетка. */
export function loadStep(load: number | null): number | null {
  if (load === null || !Number.isFinite(load)) return null;
  const clamped = Math.min(1, Math.max(0, load));
  return Math.min(LOAD_RAMP.length - 1, Math.floor(clamped * LOAD_RAMP.length));
}

/** Цвет текста на клетке: тёмный на светлых ступенях, белый на тёмных (контраст ≥ 4.5). */
export function loadTextColor(step: number | null): string {
  return step !== null && step >= 4 ? '#ffffff' : '#1f1f1f';
}

// ---------------------------------------------------------------- цели ТЗ

export type GoalKey = 'ownChannel' | 'banquetSla' | 'lostBanquets' | 'overbookings' | 'dailyReports';
export type GoalStatus = 'met' | 'not_met' | 'no_target' | 'no_data';

export interface GoalRow {
  key: GoalKey;
  /** Значение для отображения: доля 0..1 или число. */
  value: number | null;
  kind: 'ratio' | 'count' | 'progress';
  /** Цель из ТЗ: доля, число или null — «уточнить после discovery». */
  target: number | null;
  status: GoalStatus;
  /** Для progress: сформировано из ожидаемых. */
  expected?: number;
}

/** Цели ТЗ (раздел «Цели и границы»): свой канал — цель уточняется; ответ на банкет за 30 минут ≥ 95%; потерь и накладок — 0; дневной отчёт — автоматически. */
export const GOAL_TARGETS = { banquetSla: 0.95, lostBanquets: 0, overbookings: 0 } as const;

export function goalRows(goals: GoalsReport): GoalRow[] {
  const sla = goals.banquetAnsweredWithinSlaShare;
  return [
    {
      key: 'ownChannel',
      value: goals.ownChannelShare,
      kind: 'ratio',
      target: null,
      status: goals.ownChannelShare === null ? 'no_data' : 'no_target',
    },
    {
      key: 'banquetSla',
      value: sla,
      kind: 'ratio',
      target: GOAL_TARGETS.banquetSla,
      status: sla === null ? 'no_data' : sla >= GOAL_TARGETS.banquetSla ? 'met' : 'not_met',
    },
    {
      key: 'lostBanquets',
      value: goals.lostBanquetRequests,
      kind: 'count',
      target: GOAL_TARGETS.lostBanquets,
      status: goals.lostBanquetRequests <= GOAL_TARGETS.lostBanquets ? 'met' : 'not_met',
    },
    {
      key: 'overbookings',
      value: goals.overbookings,
      kind: 'count',
      target: GOAL_TARGETS.overbookings,
      status: goals.overbookings <= GOAL_TARGETS.overbookings ? 'met' : 'not_met',
    },
    {
      key: 'dailyReports',
      value: goals.dailyReportsGenerated,
      kind: 'progress',
      expected: goals.dailyReportsExpected,
      target: goals.dailyReportsExpected,
      status: goals.dailyReportsExpected === 0 ? 'no_data' : goals.dailyReportsGenerated >= goals.dailyReportsExpected ? 'met' : 'not_met',
    },
  ];
}
