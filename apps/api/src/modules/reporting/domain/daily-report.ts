import { Money } from '../../../shared/kernel/money';
import { addDays, zonedParts } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { formatTenge } from './amounts';
import { localDateOf, REPORTING_TIMEZONE } from './period';

/**
 * Дневной отчёт: формируется автоматически в 23:30 (Asia/Almaty) по филиалам и сводный по сети,
 * хранится (XLSX в приватном хранилище) и отправляется собственнику и управляющим.
 */
export const DAILY_REPORT_SCHEDULE = '30 23 * * *';

/** Ключ области отчёта: 'all' — сводный, иначе id филиала. */
export const CONSOLIDATED_SCOPE = 'all';

export function dailyScope(branchId: string | null): string {
  return branchId ?? CONSOLIDATED_SCOPE;
}

/**
 * За какой день строить отчёт: расписание срабатывает в 23:30 — сегодняшний день;
 * если задача выполнилась с задержкой уже после полуночи (до полудня) — вчерашний.
 */
export function dailyReportDate(now: Date): string {
  const today = localDateOf(now);
  return zonedParts(now, REPORTING_TIMEZONE).hour < 12 ? addDays(today, -1) : today;
}

export interface DailyRevenue {
  delivery: Money;
  pickup: Money;
  banquet: Money;
  certificate: Money;
  refunds: Money;
  total: Money;
}

export interface DailySummary {
  date: string;
  branchId: string | null;
  revenue: DailyRevenue;
  orders: { placed: number; completed: number; cancelled: number; averageCheck: Money };
  reservations: { created: number; guests: number; starting: number };
  banquets: { newRequests: number; answeredWithinSla: number; unansweredOverdue: number; held: number; heldTotal: Money };
  payments: { received: Money; refunded: Money };
  storefront: { sessions: number; orderedSessions: number; conversion: number | null };
  topDishes: Array<{ dishId: string; name: Translatable; quantity: number; revenue: Money }>;
}

function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 1000) / 10}%`;
}

/** Краткий текст для WhatsApp/Telegram персоналу (ru). */
export function dailySummaryText(summary: DailySummary, scopeName: string): string {
  const r = summary.revenue;
  const parts = [
    `${scopeName}: выручка ${formatTenge(r.total)} (доставка ${formatTenge(r.delivery)}, самовывоз ${formatTenge(r.pickup)}, ` +
      `банкеты ${formatTenge(r.banquet)}, сертификаты ${formatTenge(r.certificate)}` +
      (r.refunds.isZero() ? ')' : `, возвраты ${formatTenge(r.refunds)})`),
    `заказы: ${summary.orders.completed} выполнено, ${summary.orders.placed} оформлено, ${summary.orders.cancelled} отменено, ` +
      `средний чек ${formatTenge(summary.orders.averageCheck)}`,
    `брони: ${summary.reservations.created} новых, ${summary.reservations.starting} на сегодня`,
    `банкеты: ${summary.banquets.newRequests} заявок (в срок ${summary.banquets.answeredWithinSla}, без ответа ${summary.banquets.unansweredOverdue}), ` +
      `проведено ${summary.banquets.held}`,
    `конверсия витрины ${percent(summary.storefront.conversion)}`,
  ];
  return parts.join('; ');
}

/** Дата для текста уведомления: 01.10.2026. */
export function formatDisplayDate(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}.${m}.${y}`;
}
