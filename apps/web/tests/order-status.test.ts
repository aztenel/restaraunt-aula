import { describe, expect, it } from 'vitest';
import type { OrderTracking } from '@/lib/api-types';
import { isPurchaseComplete, ORDER_POLL, orderPaymentRedirect, orderPhase, orderPollDelay, timelineSteps } from '@/lib/order-status';

type Tracking = Pick<OrderTracking, 'status' | 'type' | 'payment' | 'timeline'>;
const money = { amount: 1_000_000, currency: 'KZT' as const };

function order(patch: Partial<Tracking> & { current?: Partial<NonNullable<OrderTracking['payment']['current']>> | null; method?: 'online' | 'on_receipt'; isPaid?: boolean }): Tracking {
  const { current, method = 'online', isPaid = false, ...rest } = patch;
  return {
    status: 'awaiting_payment',
    type: 'delivery',
    timeline: [],
    payment: {
      method,
      isPaid,
      certificateAmount: { amount: 0, currency: 'KZT' },
      amountDue: money,
      canRetry: false,
      payUntil: null,
      current:
        current === null
          ? null
          : { id: 'pay-1', method: 'online', status: 'pending', amount: money, paymentUrl: null, ...(current ?? {}) },
    },
    ...rest,
  };
}

describe('статус заказа: экран', () => {
  it('онлайн-оплата: ссылка готовится → ждём оплату → попытка не прошла', () => {
    expect(orderPhase(order({ current: null }))).toBe('preparing_payment');
    expect(orderPhase(order({ current: { paymentUrl: null } }))).toBe('preparing_payment');
    expect(orderPhase(order({ current: { paymentUrl: 'https://pay.example/1' } }))).toBe('awaiting_payment');
    expect(orderPhase(order({ current: { status: 'failed', paymentUrl: 'https://pay.example/1' } }))).toBe('payment_failed');
    expect(orderPhase(order({ current: { status: 'cancelled' } }))).toBe('payment_failed');
  });

  it('оплата при получении — сразу «готовим», итоговые статусы', () => {
    expect(orderPhase(order({ status: 'draft', method: 'on_receipt', current: null }))).toBe('in_progress');
    expect(orderPhase(order({ status: 'cooking' }))).toBe('in_progress');
    expect(orderPhase(order({ status: 'completed' }))).toBe('completed');
    expect(orderPhase(order({ status: 'cancelled' }))).toBe('cancelled');
    expect(orderPhase(order({ status: 'refunded' }))).toBe('cancelled');
  });
});

describe('статус заказа: опрос', () => {
  it('частота зависит от этапа, итоговый статус — без опроса', () => {
    expect(orderPollDelay(order({ current: null }), 0)).toBe(ORDER_POLL.preparing);
    expect(orderPollDelay(order({ current: { paymentUrl: 'https://pay.example/1' } }), 0)).toBe(ORDER_POLL.awaiting);
    expect(orderPollDelay(order({ current: { status: 'failed' } }), 0)).toBe(ORDER_POLL.failed);
    expect(orderPollDelay(order({ status: 'cooking' }), 0)).toBe(ORDER_POLL.progress);
    expect(orderPollDelay(order({ status: 'completed' }), 0)).toBeNull();
    expect(orderPollDelay(order({ status: 'cancelled' }), 0)).toBeNull();
  });

  it('долго открытая вкладка опрашивается реже', () => {
    expect(orderPollDelay(order({ current: null }), ORDER_POLL.slowAfterMs + 1)).toBe(ORDER_POLL.slow);
    expect(orderPollDelay(order({ status: 'cooking' }), ORDER_POLL.slowAfterMs + 1)).toBe(ORDER_POLL.slow);
  });
});

describe('статус заказа: переход на оплату', () => {
  const ready = order({ current: { paymentUrl: 'https://pay.example/1' } });

  it('один раз и только сразу после оформления (?pay=1)', () => {
    expect(orderPaymentRedirect(ready, { autoPay: true, alreadyRedirected: false })).toBe('https://pay.example/1');
    expect(orderPaymentRedirect(ready, { autoPay: true, alreadyRedirected: true })).toBeNull();
    expect(orderPaymentRedirect(ready, { autoPay: false, alreadyRedirected: false })).toBeNull();
  });

  it('не переводим, пока ссылки нет, после неудачи и на небезопасную ссылку', () => {
    expect(orderPaymentRedirect(order({ current: null }), { autoPay: true, alreadyRedirected: false })).toBeNull();
    expect(orderPaymentRedirect(order({ current: { status: 'failed', paymentUrl: 'https://pay.example/1' } }), { autoPay: true, alreadyRedirected: false })).toBeNull();
    expect(orderPaymentRedirect(order({ current: { paymentUrl: 'javascript:alert(1)' } }), { autoPay: true, alreadyRedirected: false })).toBeNull();
  });

  it('при оплате при получении не переводим никогда', () => {
    expect(orderPaymentRedirect(order({ method: 'on_receipt', current: { paymentUrl: 'https://pay.example/1' } }), { autoPay: true, alreadyRedirected: false })).toBeNull();
  });

  it('цель «покупка» — только для оплаченного и не отменённого заказа', () => {
    expect(isPurchaseComplete(order({ isPaid: true, status: 'paid' }))).toBe(true);
    expect(isPurchaseComplete(order({ isPaid: false }))).toBe(false);
    expect(isPurchaseComplete(order({ isPaid: true, status: 'refunded' }))).toBe(false);
  });
});

describe('статус заказа: лента', () => {
  it('доставка с онлайн-оплатой: пройденные этапы с временем, текущий и предстоящие', () => {
    const steps = timelineSteps(
      order({
        status: 'cooking',
        timeline: [
          { status: 'awaiting_payment', at: '2026-09-25T10:00:00Z' },
          { status: 'paid', at: '2026-09-25T10:01:00Z' },
          { status: 'accepted', at: '2026-09-25T10:02:00Z' },
          { status: 'cooking', at: '2026-09-25T10:05:00Z' },
        ],
      }),
    );
    expect(steps.map((s) => [s.status, s.state])).toEqual([
      ['awaiting_payment', 'done'],
      ['paid', 'done'],
      ['accepted', 'done'],
      ['cooking', 'current'],
      ['ready', 'upcoming'],
      ['delivering', 'upcoming'],
      ['completed', 'upcoming'],
    ]);
    expect(steps[1]!.at).toBe('2026-09-25T10:01:00Z');
  });

  it('самовывоз с оплатой при получении — без «ожидает оплаты» и «в пути»', () => {
    const steps = timelineSteps(order({ type: 'pickup', method: 'on_receipt', status: 'completed' }));
    expect(steps.map((s) => s.status)).toEqual(['paid', 'accepted', 'cooking', 'ready', 'completed']);
    expect(steps.at(-1)!.state).toBe('done');
  });

  it('отменённый заказ — фактическая история без черновика', () => {
    const steps = timelineSteps(
      order({
        status: 'cancelled',
        timeline: [
          { status: 'draft', at: '2026-09-25T10:00:00Z' },
          { status: 'awaiting_payment', at: '2026-09-25T10:00:01Z' },
          { status: 'cancelled', at: '2026-09-25T10:20:00Z' },
        ],
      }),
    );
    expect(steps.map((s) => [s.status, s.state])).toEqual([
      ['awaiting_payment', 'done'],
      ['cancelled', 'current'],
    ]);
  });
});
