/**
 * Очередь оператора: чистые функции (тестируются без браузера) — колонки, время с оформления,
 * новые оплаченные заказы между опросами (звук и подсветка без ленты событий).
 */
import type { OrderQueue, OrderStatus, QueueOrder } from '../types';

/** Колонки канбана: новые (оплачены, ждут принятия) → приняты → готовятся → готовы → в пути. */
export const QUEUE_COLUMNS = ['paid', 'accepted', 'cooking', 'ready', 'delivering'] as const satisfies readonly OrderStatus[];
export type QueueColumn = (typeof QUEUE_COLUMNS)[number];

export function ordersIn(queue: OrderQueue | undefined, status: OrderStatus): QueueOrder[] {
  return queue?.groups.find((g) => g.status === status)?.orders ?? [];
}

export function countIn(queue: OrderQueue | undefined, status: OrderStatus): number {
  const group = queue?.groups.find((g) => g.status === status);
  return group ? group.count : 0;
}

/** id заказов, ждущих принятия (колонка «Новые»). */
export function newOrderIds(queue: OrderQueue | undefined): Set<string> {
  return new Set(ordersIn(queue, 'paid').map((o) => o.id));
}

/** Появившиеся с прошлого опроса новые заказы; первый ответ (previous = null) — не «новые». */
export function arrivedSince(previous: ReadonlySet<string> | null, current: ReadonlySet<string>): string[] {
  if (previous === null) return [];
  return [...current].filter((id) => !previous.has(id));
}

export interface ElapsedParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Сколько прошло с момента (целые минуты); будущее время — ноль. */
export function elapsedParts(fromIso: string, nowMs: number): ElapsedParts {
  const from = Date.parse(fromIso);
  const totalMinutes = Number.isFinite(from) ? Math.max(0, Math.floor((nowMs - from) / 60_000)) : 0;
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  return { days, hours, minutes: totalMinutes % 60 };
}

/** Сводка очереди для виджета: активные (без ожидающих оплаты), опаздывающие, ждущие оплату. */
export function queueSummary(queue: OrderQueue | undefined): { active: number; late: number; awaitingPayment: number } {
  let active = 0;
  let late = 0;
  for (const status of QUEUE_COLUMNS) {
    const orders = ordersIn(queue, status);
    active += countIn(queue, status);
    late += orders.filter((o) => o.isLate).length;
  }
  return { active, late, awaitingPayment: countIn(queue, 'awaiting_payment') };
}
