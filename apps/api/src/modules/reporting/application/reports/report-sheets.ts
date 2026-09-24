import { XlsxSheet } from '../../../../shared/infrastructure/xlsx/xlsx-builder';
import { MoneyJson } from '../../../../shared/kernel/money';
import { translate, Translatable } from '../../../../shared/kernel/translatable';
import { DailySummary } from '../../domain/daily-report';
import { ChannelAmounts, SalesChannel } from '../../domain/revenue';
import { DashboardView, GoalsReportView } from './dashboard.queries';
import { CancelledOrdersReportView, ConversionReportView, TopDishesReportView } from './orders.queries';
import { CashFlowReportView, CertificatesReportView } from './payments.queries';
import { AverageCheckReportView, OwnChannelReportView, RevenueReportView } from './sales.queries';
import { BanquetFunnelReportView, HallLoadReportView } from './venues.queries';

/**
 * Выгрузка отчётов в XLSX: суммы — в тиынах (формат money выводит тенге), даты — Asia/Almaty.
 * Названия колонок — по-русски (язык админки по умолчанию).
 */
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type Row = Record<string, unknown>;
type Money = MoneyJson | { amount: number; currency: string };

const CHANNEL_LABELS: Record<SalesChannel, string> = {
  delivery: 'Доставка',
  pickup: 'Самовывоз',
  banquet: 'Банкеты',
  certificate: 'Сертификаты',
};

const WEEKDAY_LABELS: Record<string, string> = { mon: 'Пн', tue: 'Вт', wed: 'Ср', thu: 'Чт', fri: 'Пт', sat: 'Сб', sun: 'Вс' };

function name(value: Translatable | null | undefined): string {
  return translate(value ?? {}, 'ru');
}

function channelColumns() {
  return [
    { header: 'Доставка, ₸', key: 'delivery', format: 'money' as const },
    { header: 'Самовывоз, ₸', key: 'pickup', format: 'money' as const },
    { header: 'Банкеты, ₸', key: 'banquet', format: 'money' as const },
    { header: 'Сертификаты, ₸', key: 'certificate', format: 'money' as const },
    { header: 'Возвраты, ₸', key: 'refunds', format: 'money' as const },
    { header: 'Итого, ₸', key: 'total', format: 'money' as const },
  ];
}

function channelRow(c: ChannelAmounts): Row {
  return { delivery: c.delivery, pickup: c.pickup, banquet: c.banquet, certificate: c.certificate, refunds: c.refunds, total: c.total };
}

/** Лист «Параметры»: период и область отчёта. */
function paramsSheet(title: string, h: { from?: string; to?: string; branchId: string | null }, branchName?: string): XlsxSheet {
  return {
    name: 'Параметры',
    columns: [
      { header: 'Параметр', key: 'key', width: 24 },
      { header: 'Значение', key: 'value', width: 40 },
    ],
    rows: [
      { key: 'Отчёт', value: title },
      ...(h.from ? [{ key: 'Период с', value: h.from }] : []),
      ...(h.to ? [{ key: 'Период по', value: h.to }] : []),
      { key: 'Филиал', value: h.branchId ? (branchName ?? h.branchId) : 'Все филиалы (сводный)' },
    ],
  };
}

export function revenueSheets(v: RevenueReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Выручка по дням',
      columns: [{ header: 'Дата', key: 'date', format: 'date' }, ...channelColumns()],
      rows: [...v.days.map((d) => ({ date: d.date, ...channelRow(d) })), { date: null, ...channelRow(v.totals) }],
    },
    {
      name: 'По филиалам',
      columns: [{ header: 'Филиал', key: 'branchId', width: 38 }, ...channelColumns()],
      rows: v.byBranch.map((b) => ({ branchId: b.branchId ?? 'без филиала', ...channelRow(b) })),
    },
    paramsSheet('Выручка по дням и каналам', v),
  ];
}

export function averageCheckSheets(v: AverageCheckReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Средний чек',
      columns: [
        { header: 'Канал', key: 'channel', width: 20 },
        { header: 'Продаж', key: 'count', format: 'number' },
        { header: 'Выручка, ₸', key: 'revenue', format: 'money' },
        { header: 'Средний чек, ₸', key: 'average', format: 'money' },
      ],
      rows: [
        ...v.channels.map((c) => ({ channel: CHANNEL_LABELS[c.channel], count: c.count, revenue: c.revenue, average: c.average })),
        { channel: 'Заказы (доставка + самовывоз)', ...v.orders },
      ],
    },
    paramsSheet('Средний чек', v),
  ];
}

export function conversionSheets(v: ConversionReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Воронка витрины',
      columns: [
        { header: 'Шаг', key: 'step', width: 34 },
        { header: 'Сессий', key: 'sessions', format: 'number' },
      ],
      rows: [
        { step: 'Сессии витрины', sessions: v.sessions },
        { step: 'Просмотр меню', sessions: v.menuViewSessions },
        { step: 'Карточка блюда', sessions: v.dishViewSessions },
        { step: 'Добавили в корзину', sessions: v.addToCartSessions },
        { step: 'Начали оформление', sessions: v.checkoutSessions },
        { step: 'Оформили заказ', sessions: v.orderedSessions },
      ],
    },
    {
      name: 'По дням',
      columns: [
        { header: 'Дата', key: 'date', format: 'date' },
        { header: 'Сессий', key: 'sessions', format: 'number' },
        { header: 'С заказом', key: 'orderedSessions', format: 'number' },
        { header: 'Конверсия', key: 'conversion', format: 'percent' },
      ],
      rows: [...v.days, { date: null, sessions: v.sessions, orderedSessions: v.orderedSessions, conversion: v.conversion }],
    },
    paramsSheet('Конверсия витрины в заказ', v),
  ];
}

export function topDishesSheets(v: TopDishesReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Топ блюд',
      columns: [
        { header: '№', key: 'rank', format: 'number', width: 6 },
        { header: 'Блюдо', key: 'name', width: 40 },
        { header: 'Количество', key: 'quantity', format: 'number' },
        { header: 'Заказов', key: 'orders', format: 'number' },
        { header: 'Выручка, ₸', key: 'revenue', format: 'money' },
        { header: 'Доля выручки', key: 'revenueShare', format: 'percent' },
      ],
      rows: v.items.map((i) => ({ ...i, name: name(i.name) })),
    },
    paramsSheet('Топ блюд', v),
  ];
}

export function hallLoadSheets(v: HallLoadReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Загрузка по типам',
      columns: [
        { header: 'День недели', key: 'weekday', width: 12 },
        { header: 'Тип места', key: 'type', width: 24 },
        { header: 'Мест', key: 'venues', format: 'number' },
        { header: 'Доступно, ч', key: 'openHours' },
        { header: 'Занято, ч', key: 'bookedHours' },
        { header: 'Загрузка', key: 'load', format: 'percent' },
        { header: 'Броней', key: 'reservations', format: 'number' },
        { header: 'Гостей', key: 'guests', format: 'number' },
      ],
      rows: v.rows.map((r) => ({ ...r, weekday: WEEKDAY_LABELS[r.weekday], type: name(r.venueTypeName) || r.venueTypeCode })),
    },
    {
      name: 'По дням недели',
      columns: [
        { header: 'День недели', key: 'weekday', width: 12 },
        { header: 'Доступно, ч', key: 'openHours' },
        { header: 'Занято, ч', key: 'bookedHours' },
        { header: 'Загрузка', key: 'load', format: 'percent' },
        { header: 'Броней', key: 'reservations', format: 'number' },
        { header: 'Гостей', key: 'guests', format: 'number' },
      ],
      rows: v.weekdays.map((w) => ({ ...w, weekday: WEEKDAY_LABELS[w.weekday] })),
    },
    {
      name: 'Накладки',
      columns: [
        { header: 'Место', key: 'venueId', width: 38 },
        { header: 'Бронь 1', key: 'first', width: 18 },
        { header: 'Начало 1', key: 'firstStart', format: 'datetime' },
        { header: 'Бронь 2', key: 'second', width: 18 },
        { header: 'Начало 2', key: 'secondStart', format: 'datetime' },
      ],
      rows: v.overbookings.map((o) => ({
        venueId: o.venueId,
        first: o.first.number,
        firstStart: o.first.start,
        second: o.second.number,
        secondStart: o.second.start,
      })),
    },
    paramsSheet('Загрузка залов по дням недели', v),
  ];
}

export function banquetFunnelSheets(v: BanquetFunnelReportView): XlsxSheet<any>[] {
  const STAGE_LABELS: Record<string, string> = {
    new: 'Новая',
    in_progress: 'В работе',
    quote_sent: 'Смета отправлена',
    agreed: 'Согласована',
    prepaid: 'Предоплата получена',
    held: 'Проведено',
  };
  return [
    {
      name: 'Воронка',
      columns: [
        { header: 'Стадия', key: 'stage', width: 24 },
        { header: 'Дошли до стадии', key: 'reached', format: 'number' },
        { header: 'Сейчас на стадии', key: 'current', format: 'number' },
      ],
      rows: v.stages.map((s) => ({ stage: STAGE_LABELS[s.status] ?? s.status, reached: s.reached, current: s.current })),
    },
    {
      name: 'Показатели',
      columns: [
        { header: 'Показатель', key: 'metric', width: 40 },
        { header: 'Значение', key: 'value', format: 'number' },
        { header: 'Доля', key: 'share', format: 'percent' },
        { header: 'Сумма, ₸', key: 'amount', format: 'money' },
      ],
      rows: [
        { metric: 'Заявок', value: v.total },
        { metric: 'Проведено', value: v.held, share: v.conversion, amount: v.heldTotal },
        { metric: `Ответ за ${v.slaMinutes} минут`, value: v.answeredWithinSla, share: v.answeredWithinSlaShare },
        { metric: 'Среднее время ответа, мин', value: v.averageFirstResponseMinutes },
        { metric: 'Медианное время ответа, мин', value: v.medianFirstResponseMinutes },
        { metric: 'Без ответа дольше SLA', value: v.unansweredOverdue },
        { metric: 'Отменено', value: v.cancelled },
        { metric: 'Потеряно', value: v.lost },
      ],
    },
    {
      name: 'Причины отмен',
      columns: [
        { header: 'Причина', key: 'reason', width: 40 },
        { header: 'Заявок', key: 'count', format: 'number' },
      ],
      rows: v.cancelReasons,
    },
    paramsSheet('Воронка банкетных заявок', v),
  ];
}

export function cancelledOrdersSheets(v: CancelledOrdersReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Причины',
      columns: [
        { header: 'Код причины', key: 'reasonCode', width: 24 },
        { header: 'Заказов', key: 'count', format: 'number' },
        { header: 'Из них оплачено', key: 'paidCount', format: 'number' },
        { header: 'Сумма, ₸', key: 'total', format: 'money' },
      ],
      rows: [...v.reasons, { reasonCode: 'Итого', count: v.cancelled, paidCount: null, total: v.cancelledTotal }],
    },
    {
      name: 'Заказы',
      columns: [
        { header: 'Номер', key: 'number', width: 18 },
        { header: 'Тип', key: 'type' },
        { header: 'Канал', key: 'channel' },
        { header: 'Сумма, ₸', key: 'total', format: 'money' },
        { header: 'Причина', key: 'reasonCode', width: 20 },
        { header: 'Комментарий', key: 'reason', width: 40 },
        { header: 'Был оплачен', key: 'wasPaid' },
        { header: 'Оформлен', key: 'placedAt', format: 'datetime' },
        { header: 'Отменён', key: 'cancelledAt', format: 'datetime' },
      ],
      rows: v.orders.items.map((o) => ({ ...o, wasPaid: o.wasPaid ? 'да' : 'нет' })),
    },
    paramsSheet('Отменённые заказы и причины', v),
  ];
}

export function cashFlowSheets(v: CashFlowReportView): XlsxSheet<any>[] {
  const moneyCols = [
    { header: 'Поступило, ₸', key: 'received', format: 'money' as const },
    { header: 'Возвращено, ₸', key: 'refunded', format: 'money' as const },
    { header: 'Нетто, ₸', key: 'net', format: 'money' as const },
  ];
  return [
    {
      name: 'По способам оплаты',
      columns: [
        { header: 'Способ', key: 'method', width: 20 },
        { header: 'Провайдер', key: 'provider', width: 20 },
        { header: 'Платежей', key: 'receivedCount', format: 'number' },
        { header: 'Возвратов', key: 'refundedCount', format: 'number' },
        ...moneyCols,
      ],
      rows: [...v.methods, { method: 'Итого', ...v.totals }],
    },
    { name: 'По назначению', columns: [{ header: 'Назначение', key: 'purpose', width: 24 }, ...moneyCols], rows: v.purposes },
    { name: 'По дням', columns: [{ header: 'Дата', key: 'date', format: 'date' }, ...moneyCols], rows: v.days },
    paramsSheet('Движение денег (поступления и возвраты)', v),
  ];
}

export function certificatesSheets(v: CertificatesReportView): XlsxSheet<any>[] {
  const rows: Row[] = [
    { metric: 'Выпущено', count: v.issued.count, amount: v.issued.nominal },
    { metric: 'Выпущено (цена продажи)', count: v.issued.count, amount: v.issued.price },
    { metric: 'Погашено', count: v.redeemed.count, amount: v.redeemed.amount },
  ];
  if (v.expired) rows.push({ metric: 'Просрочено (сгоревший остаток)', count: v.expired.count, amount: v.expired.balance });
  if (v.outstanding) rows.push({ metric: `Остаток обязательств на ${v.outstanding.asOf}`, count: v.outstanding.count, amount: v.outstanding.balance });
  return [
    {
      name: 'Сертификаты',
      columns: [
        { header: 'Показатель', key: 'metric', width: 40 },
        { header: 'Количество', key: 'count', format: 'number' },
        { header: 'Сумма, ₸', key: 'amount', format: 'money' },
      ],
      rows,
    },
    {
      name: 'Погашения по каналам',
      columns: [
        { header: 'Канал', key: 'channel' },
        { header: 'Количество', key: 'count', format: 'number' },
        { header: 'Сумма, ₸', key: 'amount', format: 'money' },
      ],
      rows: v.redeemedByChannel,
    },
    paramsSheet('Подарочные сертификаты', v),
  ];
}

export function ownChannelSheets(v: OwnChannelReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Доля своего канала',
      columns: [
        { header: 'Месяц', key: 'month', width: 10 },
        { header: 'Сайт', key: 'webOrders', format: 'number' },
        { header: 'Оператор', key: 'adminOrders', format: 'number' },
        { header: 'Свой канал', key: 'ownOrders', format: 'number' },
        { header: 'Выручка своего канала, ₸', key: 'ownRevenue', format: 'money' },
        { header: 'Агрегаторы', key: 'aggregatorOrders', format: 'number' },
        { header: 'Выручка агрегаторов, ₸', key: 'aggregatorRevenue', format: 'money' },
        { header: 'Доля своего канала', key: 'ownShare', format: 'percent' },
      ],
      rows: [...v.months, { month: 'Итого', ...v.totals }],
    },
    paramsSheet('Доля заказов мимо агрегаторов', v),
  ];
}

function kpiRows(label: string, k: DashboardView['today']): Row[] {
  return [
    { period: label, metric: 'Выручка', amount: k.revenue },
    { period: label, metric: 'Выполнено заказов', value: k.completedOrders },
    { period: label, metric: 'Средний чек', amount: k.averageCheck },
    { period: label, metric: 'Оформлено заказов', value: k.placedOrders },
    { period: label, metric: 'Отменено заказов', value: k.cancelledOrders },
    { period: label, metric: 'Новых броней', value: k.reservations },
    { period: label, metric: 'Гостей в бронях', value: k.guests },
    { period: label, metric: 'Банкетных заявок', value: k.banquetRequests },
    { period: label, metric: 'Ответ на банкет за 30 минут', share: k.banquetAnsweredWithinSlaShare },
    { period: label, metric: 'Сессий витрины', value: k.sessions },
    { period: label, metric: 'Конверсия витрины', share: k.conversion },
  ];
}

export function dashboardSheets(v: DashboardView): XlsxSheet<any>[] {
  return [
    {
      name: 'Показатели',
      columns: [
        { header: 'Период', key: 'period', width: 18 },
        { header: 'Показатель', key: 'metric', width: 32 },
        { header: 'Значение', key: 'value', format: 'number' },
        { header: 'Доля', key: 'share', format: 'percent' },
        { header: 'Сумма, ₸', key: 'amount', format: 'money' },
      ],
      rows: [...kpiRows('Сегодня', v.today), ...kpiRows('Вчера', v.yesterday), ...kpiRows('7 дней', v.last7Days)],
    },
    paramsSheet('Панель показателей', { branchId: v.branchId }),
  ];
}

export function goalsSheets(v: GoalsReportView): XlsxSheet<any>[] {
  return [
    {
      name: 'Цели',
      columns: [
        { header: 'Цель', key: 'goal', width: 40 },
        { header: 'Значение', key: 'value', format: 'number' },
        { header: 'Доля', key: 'share', format: 'percent' },
      ],
      rows: [
        { goal: 'Доля заказов мимо агрегаторов', value: v.ownOrders, share: v.ownChannelShare },
        { goal: 'Заказы агрегаторов (ручной ввод)', value: v.aggregatorOrders },
        { goal: 'Банкетные заявки с ответом за 30 минут', value: v.banquetRequests, share: v.banquetAnsweredWithinSlaShare },
        { goal: 'Потерянные банкетные заявки', value: v.lostBanquetRequests },
        { goal: 'Накладки по залам', value: v.overbookings },
        { goal: 'Дневных отчётов сформировано', value: v.dailyReportsGenerated },
        { goal: 'Завершённых дней в периоде', value: v.dailyReportsExpected },
      ],
    },
    paramsSheet('Цели ТЗ', v),
  ];
}

/** Дневной отчёт (сводка в JSON-форме: деньги — { amount, currency }). */
export function dailySheets(summary: DailySummary | DailySummaryJson, scopeName: string): XlsxSheet<any>[] {
  const s = summary as DailySummaryJson;
  const r = s.revenue;
  return [
    {
      name: 'Сводка',
      columns: [
        { header: 'Показатель', key: 'metric', width: 36 },
        { header: 'Значение', key: 'value', format: 'number' },
        { header: 'Доля', key: 'share', format: 'percent' },
        { header: 'Сумма, ₸', key: 'amount', format: 'money' },
      ],
      rows: [
        { metric: 'Выручка, итого', amount: r.total },
        { metric: 'Доставка', amount: r.delivery },
        { metric: 'Самовывоз', amount: r.pickup },
        { metric: 'Банкеты', amount: r.banquet },
        { metric: 'Сертификаты', amount: r.certificate },
        { metric: 'Возвраты', amount: r.refunds },
        { metric: 'Заказов оформлено', value: s.orders.placed },
        { metric: 'Заказов выполнено', value: s.orders.completed },
        { metric: 'Заказов отменено', value: s.orders.cancelled },
        { metric: 'Средний чек', amount: s.orders.averageCheck },
        { metric: 'Новых броней', value: s.reservations.created },
        { metric: 'Гостей в новых бронях', value: s.reservations.guests },
        { metric: 'Броней на этот день', value: s.reservations.starting },
        { metric: 'Банкетных заявок', value: s.banquets.newRequests },
        { metric: 'Ответ на заявку за 30 минут', value: s.banquets.answeredWithinSla },
        { metric: 'Заявок без ответа дольше 30 минут', value: s.banquets.unansweredOverdue },
        { metric: 'Проведено банкетов', value: s.banquets.held, amount: s.banquets.heldTotal },
        { metric: 'Поступило денег', amount: s.payments.received },
        { metric: 'Возвращено денег', amount: s.payments.refunded },
        { metric: 'Сессий витрины', value: s.storefront.sessions },
        { metric: 'Сессий с заказом', value: s.storefront.orderedSessions, share: s.storefront.conversion },
      ],
    },
    {
      name: 'Топ блюд',
      columns: [
        { header: 'Блюдо', key: 'name', width: 40 },
        { header: 'Количество', key: 'quantity', format: 'number' },
        { header: 'Выручка, ₸', key: 'revenue', format: 'money' },
      ],
      rows: s.topDishes.map((d) => ({ ...d, name: name(d.name) })),
    },
    {
      name: 'Параметры',
      columns: [
        { header: 'Параметр', key: 'key', width: 24 },
        { header: 'Значение', key: 'value', width: 40 },
      ],
      rows: [
        { key: 'Отчёт', value: 'Дневной отчёт' },
        { key: 'Дата', value: s.date },
        { key: 'Филиал', value: scopeName },
      ],
    },
  ];
}

/** Сводка дневного отчёта в JSON-форме (как хранится и отдаётся в API). */
export type DailySummaryJson = {
  [K in keyof DailySummary]: DailySummary[K] extends object ? JsonOf<DailySummary[K]> : DailySummary[K];
};
type JsonOf<T> = T extends { amount: number; currency: string }
  ? Money
  : T extends Array<infer U>
    ? Array<JsonOf<U>>
    : T extends object
      ? { [K in keyof T]: JsonOf<T[K]> }
      : T;

export function toSummaryJson(summary: DailySummary): DailySummaryJson {
  return JSON.parse(JSON.stringify(summary)) as DailySummaryJson;
}
