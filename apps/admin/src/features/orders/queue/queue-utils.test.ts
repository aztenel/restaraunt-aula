import { describe, expect, it } from 'vitest';
import type { OrderQueue, QueueOrder } from '../types';
import { arrivedSince, elapsedParts, newOrderIds, queueSummary } from './queue-utils';

function order(id: string, status: QueueOrder['status'], isLate = false): QueueOrder {
  return {
    id,
    number: `GL-2026-${id}`,
    branchId: 'b1',
    type: 'delivery',
    channel: 'web',
    status,
    customer: { customerId: null, name: 'Айгерим', phone: '+77771234567', email: null },
    total: { amount: 500_000, currency: 'KZT' },
    paymentMethod: 'online',
    promoCode: null,
    placedAt: '2026-09-25T10:00:00.000Z',
    scheduledFor: null,
    promisedAt: '2026-09-25T11:00:00.000Z',
    items: [],
    comment: null,
    deliveryAddress: null,
    contactless: false,
    allowedTransitions: [],
    isLate,
    canCancel: false,
    canReject: false,
    courier: null,
    amountDue: { amount: 500_000, currency: 'KZT' },
  };
}

const queue: OrderQueue = {
  generatedAt: '2026-09-25T10:30:00.000Z',
  groups: [
    { status: 'awaiting_payment', count: 1, orders: [order('1', 'awaiting_payment')] },
    { status: 'paid', count: 2, orders: [order('2', 'paid'), order('3', 'paid', true)] },
    { status: 'accepted', count: 0, orders: [] },
    { status: 'cooking', count: 1, orders: [order('4', 'cooking', true)] },
    { status: 'ready', count: 0, orders: [] },
    { status: 'delivering', count: 1, orders: [order('5', 'delivering')] },
  ],
};

describe('очередь оператора', () => {
  it('новые заказы между опросами; первый ответ без звука', () => {
    const first = newOrderIds(queue);
    expect([...first]).toEqual(['2', '3']);
    expect(arrivedSince(null, first)).toEqual([]);
    expect(arrivedSince(new Set(['2']), first)).toEqual(['3']);
    expect(arrivedSince(first, new Set(['3']))).toEqual([]);
  });

  it('время с оформления', () => {
    const now = Date.parse('2026-09-25T10:00:00.000Z');
    expect(elapsedParts('2026-09-25T09:59:30.000Z', now)).toEqual({ days: 0, hours: 0, minutes: 0 });
    expect(elapsedParts('2026-09-25T09:47:00.000Z', now)).toEqual({ days: 0, hours: 0, minutes: 13 });
    expect(elapsedParts('2026-09-25T08:25:00.000Z', now)).toEqual({ days: 0, hours: 1, minutes: 35 });
    expect(elapsedParts('2026-09-23T07:00:00.000Z', now)).toEqual({ days: 2, hours: 3, minutes: 0 });
    expect(elapsedParts('2026-09-25T10:05:00.000Z', now)).toEqual({ days: 0, hours: 0, minutes: 0 });
  });

  it('сводка для виджета: счётчики из ответа сервера', () => {
    expect(queueSummary(queue)).toEqual({ active: 4, late: 2, awaitingPayment: 1 });
    expect(queueSummary(undefined)).toEqual({ active: 0, late: 0, awaitingPayment: 0 });
  });
});
