/**
 * Страница статуса заказа (GET /public/orders/:token): что показать, как часто опрашивать,
 * когда перевести на оплату. Статусы и переходы определяет сервер (конечный автомат ТЗ) —
 * здесь только выбор экрана по его ответу.
 */
import type { OrderStatus, OrderTracking } from './api-types';
import { isSafePaymentUrl } from './payment-flow';

export type OrderPhase =
  /** Онлайн-оплата: ссылка ещё готовится (задача в очереди). */
  | 'preparing_payment'
  /** Ссылка готова, ждём оплату/подтверждение от провайдера. */
  | 'awaiting_payment'
  /** Попытка оплаты отклонена или отменена — можно оплатить снова. */
  | 'payment_failed'
  /** Оплачен (или оплата при получении обеспечена) — готовим/везём. */
  | 'in_progress'
  | 'completed'
  | 'cancelled';

type TrackingForPhase = Pick<OrderTracking, 'status' | 'payment'>;

export function orderPhase(order: TrackingForPhase): OrderPhase {
  const { status, payment } = order;
  if (status === 'cancelled' || status === 'refunded') return 'cancelled';
  if (status === 'completed') return 'completed';
  if (status === 'draft' || status === 'awaiting_payment') {
    if (payment.method === 'on_receipt') return 'in_progress';
    const current = payment.current;
    if (current && (current.status === 'failed' || current.status === 'cancelled')) return 'payment_failed';
    if (current?.paymentUrl) return 'awaiting_payment';
    return 'preparing_payment';
  }
  return 'in_progress';
}

export const ORDER_POLL = {
  preparing: 1500,
  awaiting: 4000,
  failed: 15_000,
  progress: 15_000,
  slow: 30_000,
  /** После этого срока — опрос реже (гость мог оставить вкладку открытой). */
  slowAfterMs: 10 * 60_000,
} as const;

/** Через сколько опросить снова; null — статус конечный, опрос не нужен. */
export function orderPollDelay(order: TrackingForPhase, elapsedMs: number): number | null {
  const phase = orderPhase(order);
  if (phase === 'completed' || phase === 'cancelled') return null;
  const base =
    phase === 'preparing_payment'
      ? ORDER_POLL.preparing
      : phase === 'awaiting_payment'
        ? ORDER_POLL.awaiting
        : phase === 'payment_failed'
          ? ORDER_POLL.failed
          : ORDER_POLL.progress;
  return elapsedMs > ORDER_POLL.slowAfterMs ? Math.max(base, ORDER_POLL.slow) : base;
}

/**
 * Ссылка, на которую перевести гостя автоматически (один раз): только онлайн-оплата,
 * только сразу после оформления или нажатия «Оплатить» (autoPay), ссылка готова.
 */
export function orderPaymentRedirect(order: TrackingForPhase, input: { autoPay: boolean; alreadyRedirected: boolean }): string | null {
  if (!input.autoPay || input.alreadyRedirected || orderPhase(order) !== 'awaiting_payment') return null;
  const url = order.payment.current?.paymentUrl;
  return isSafePaymentUrl(url) ? url : null;
}

/** Цель «покупка»: заказ оплачен (или оплата при получении обеспечена) и не отменён. */
export function isPurchaseComplete(order: Pick<OrderTracking, 'status' | 'payment'>): boolean {
  return order.payment.isPaid && order.status !== 'cancelled' && order.status !== 'refunded';
}

export type TimelineState = 'done' | 'current' | 'upcoming';

export interface TimelineStep {
  status: OrderStatus;
  at: string | null;
  state: TimelineState;
}

/** Путь заказа по схеме ТЗ (без черновика): для доставки — с этапом «в пути». */
export function orderFlow(type: OrderTracking['type'], paymentMethod: OrderTracking['payment']['method']): OrderStatus[] {
  const head: OrderStatus[] = paymentMethod === 'online' ? ['awaiting_payment', 'paid'] : ['paid'];
  return [...head, 'accepted', 'cooking', 'ready', ...(type === 'delivery' ? (['delivering'] as OrderStatus[]) : []), 'completed'];
}

/**
 * Лента статусов для гостя: пройденные (с временем из timeline сервера), текущий и предстоящие.
 * Отменённый заказ — фактическая история + «отменён».
 */
export function timelineSteps(order: Pick<OrderTracking, 'status' | 'type' | 'payment' | 'timeline'>): TimelineStep[] {
  const reachedAt = new Map<OrderStatus, string>();
  for (const entry of order.timeline) reachedAt.set(entry.status, entry.at);
  if (order.status === 'cancelled' || order.status === 'refunded') {
    return order.timeline
      .filter((entry) => entry.status !== 'draft')
      .map((entry, index, all) => ({ status: entry.status, at: entry.at, state: index === all.length - 1 ? 'current' : 'done' }));
  }
  const flow = orderFlow(order.type, order.payment.method);
  const currentIndex = flow.indexOf(order.status);
  return flow.map((status, index) => ({
    status,
    at: reachedAt.get(status) ?? null,
    state: currentIndex < 0 ? 'upcoming' : index < currentIndex ? 'done' : index === currentIndex ? (status === 'completed' ? 'done' : 'current') : 'upcoming',
  }));
}
