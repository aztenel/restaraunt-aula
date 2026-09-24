import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { OrderStatus, OrderType } from '../public';
import { NewOrderInput, Order, OrderItemSnapshot } from './order';
import { canTransitionOrder, ORDER_FSM, ORDER_STATUS_ORDER } from './order-status';

const NOW = new Date('2026-10-01T08:00:00.000Z');

function item(price: number, quantity = 1, position = 0): OrderItemSnapshot {
  return {
    id: `i${position}`,
    position,
    dishId: `d${position}`,
    dishSlug: `dish-${position}`,
    categoryId: 'c1',
    sku: null,
    name: { ru: `Блюдо ${position}` },
    photoUrl: null,
    weightGrams: 300,
    quantity,
    basePrice: Money.of(price),
    unitPrice: Money.of(price),
    lineTotal: Money.of(price * quantity),
    modifiers: [],
  };
}

function input(overrides: Partial<NewOrderInput> = {}): NewOrderInput {
  const type = overrides.type ?? 'delivery';
  return {
    id: 'o1',
    number: 'GL-2026-000001',
    publicToken: 'tok',
    branchId: 'b1',
    type,
    channel: 'web',
    customer: { customerId: 'c1', name: 'Айгерим', phone: '+77010000001', email: null },
    delivery:
      type === 'delivery'
        ? { point: { lat: 51.1, lng: 71.4 }, addressText: 'Астана', apartment: null, entrance: null, floor: null, intercom: null, courierComment: null, zoneId: null }
        : null,
    contactless: false,
    scheduledFor: null,
    etaMinutes: 60,
    comment: null,
    promo: null,
    certificateMaskedCode: null,
    paymentMethod: 'online',
    items: [item(250_000, 2)],
    locale: 'ru',
    analyticsSessionId: null,
    idempotencyKey: 'k1',
    createdBy: null,
    zone:
      type === 'delivery'
        ? { zoneId: 'z1', minOrderAmount: Money.of(300_000), deliveryFee: Money.of(50_000), freeDeliveryFrom: Money.of(1_000_000), etaMinutes: 45 }
        : null,
    promoEffect: null,
    ...overrides,
  };
}

/** Заказ в нужном статусе через легальную цепочку переходов. */
function orderIn(status: OrderStatus, type: OrderType = 'delivery'): Order {
  const order = Order.create(input({ type }), NOW);
  const path: Record<OrderStatus, Array<(o: Order) => void>> = {
    draft: [],
    awaiting_payment: [(o) => o.submit(NOW)],
    paid: [(o) => o.submit(NOW), (o) => o.markPaid(NOW)],
    accepted: [(o) => o.submit(NOW), (o) => o.markPaid(NOW), (o) => o.accept(NOW)],
    cooking: [(o) => o.submit(NOW), (o) => o.markPaid(NOW), (o) => o.accept(NOW), (o) => o.startCooking(NOW)],
    ready: [(o) => o.submit(NOW), (o) => o.markPaid(NOW), (o) => o.accept(NOW), (o) => o.startCooking(NOW), (o) => o.markReady(NOW)],
    delivering: [
      (o) => o.submit(NOW),
      (o) => o.markPaid(NOW),
      (o) => o.accept(NOW),
      (o) => o.startCooking(NOW),
      (o) => o.markReady(NOW),
      (o) => o.startDelivery(NOW),
    ],
    completed: [
      (o) => o.submit(NOW),
      (o) => o.markPaid(NOW),
      (o) => o.accept(NOW),
      (o) => o.startCooking(NOW),
      (o) => o.markReady(NOW),
      ...(type === 'delivery' ? [(o: Order) => o.startDelivery(NOW)] : []),
      (o) => o.complete(NOW),
    ],
    cancelled: [(o) => o.submit(NOW), (o) => o.cancel('guest_request', null, NOW)],
    refunded: [(o) => o.submit(NOW), (o) => o.cancel('guest_request', null, NOW), (o) => o.markRefunded(NOW)],
  };
  for (const step of path[status]) step(order);
  order.pullTransitions();
  return order;
}

/** Выполнить переход методом агрегата. */
function apply(order: Order, to: OrderStatus): void {
  switch (to) {
    case 'draft':
      throw new InvalidStateTransitionError('order', order.status, 'draft');
    case 'awaiting_payment':
      return order.submit(NOW);
    case 'paid':
      return order.markPaid(NOW);
    case 'accepted':
      return order.accept(NOW);
    case 'cooking':
      return order.startCooking(NOW);
    case 'ready':
      return order.markReady(NOW);
    case 'delivering':
      return order.startDelivery(NOW);
    case 'completed':
      return order.complete(NOW);
    case 'cancelled':
      return order.cancel('other', null, NOW);
    case 'refunded':
      return order.markRefunded(NOW);
  }
}

// Схема ТЗ, переписанная независимо от реализации.
const SPEC: Array<[OrderStatus, OrderStatus]> = [
  ['draft', 'awaiting_payment'],
  ['awaiting_payment', 'paid'],
  ['awaiting_payment', 'cancelled'],
  ['paid', 'accepted'],
  ['accepted', 'cooking'],
  ['cooking', 'ready'],
  ['ready', 'delivering'],
  ['ready', 'completed'],
  ['delivering', 'completed'],
  ['accepted', 'cancelled'],
  ['cancelled', 'refunded'],
];

describe('order state machine (spec diagram)', () => {
  it('allows exactly the transitions of the spec diagram', () => {
    for (const from of ORDER_STATUS_ORDER) {
      for (const to of ORDER_STATUS_ORDER) {
        const expected = SPEC.some(([f, t]) => f === from && t === to);
        expect(ORDER_FSM.canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('completed and refunded are final', () => {
    expect(ORDER_FSM.isFinal('completed')).toBe(true);
    expect(ORDER_FSM.isFinal('refunded')).toBe(true);
  });

  it('delivery must go through delivering, pickup cannot be delivering', () => {
    expect(canTransitionOrder('delivery', 'ready', 'completed')).toBe(false);
    expect(canTransitionOrder('delivery', 'ready', 'delivering')).toBe(true);
    expect(canTransitionOrder('pickup', 'ready', 'delivering')).toBe(false);
    expect(canTransitionOrder('pickup', 'ready', 'completed')).toBe(true);
  });

  for (const type of ['delivery', 'pickup'] as const) {
    describe(`${type} order aggregate`, () => {
      for (const from of ORDER_STATUS_ORDER) {
        if (type === 'pickup' && from === 'delivering') continue;
        for (const to of ORDER_STATUS_ORDER) {
          const allowed = canTransitionOrder(type, from, to);
          it(`${from} -> ${to} is ${allowed ? 'allowed' : 'forbidden'}`, () => {
            const order = orderIn(from, type);
            if (allowed) {
              apply(order, to);
              expect(order.status).toBe(to);
              expect(order.pullTransitions()).toEqual([expect.objectContaining({ from, to, at: NOW })]);
            } else {
              expect(() => apply(order, to)).toThrow(InvalidStateTransitionError);
              expect(order.status).toBe(from);
              expect(order.pullTransitions()).toEqual([]);
            }
          });
        }
      }
    });
  }

  it('reject performs paid -> accepted -> cancelled', () => {
    const order = orderIn('paid');
    order.reject('out_of_stock', 'Нет баранины', NOW);
    expect(order.status).toBe('cancelled');
    expect(order.pullTransitions().map((t) => [t.from, t.to])).toEqual([
      ['paid', 'accepted'],
      ['accepted', 'cancelled'],
    ]);
    expect(order.snapshot().cancellation).toEqual({ reasonCode: 'out_of_stock', reason: 'Нет баранины' });
    expect(order.snapshot().wasPaid).toBe(true);
  });

  it('reject is only possible for paid orders', () => {
    expect(() => orderIn('accepted').reject('other', null, NOW)).toThrow(InvalidStateTransitionError);
    expect(() => orderIn('awaiting_payment').reject('other', null, NOW)).toThrow(InvalidStateTransitionError);
  });

  it('rejects unknown cancel reason codes', () => {
    expect(() => orderIn('awaiting_payment').cancel('whatever' as never, null, NOW)).toThrow(ValidationError);
  });

  it('staff transitions exclude payment/refund and respect the type', () => {
    expect(orderIn('paid').staffTransitions()).toEqual(['accepted']);
    expect(orderIn('accepted').staffTransitions()).toEqual(['cooking', 'cancelled']);
    expect(orderIn('ready', 'delivery').staffTransitions()).toEqual(['delivering']);
    expect(orderIn('ready', 'pickup').staffTransitions()).toEqual(['completed']);
    expect(orderIn('awaiting_payment').staffTransitions()).toEqual(['cancelled']);
    expect(orderIn('cancelled').staffTransitions()).toEqual([]);
    expect(orderIn('paid').canReject()).toBe(true);
    expect(orderIn('completed').canPartialRefund()).toBe(true);
    expect(orderIn('paid').canPartialRefund()).toBe(false);
  });
});

describe('order creation and totals', () => {
  it('computes totals on the server from item snapshots and zone terms', () => {
    const order = Order.create(input(), NOW);
    const t = order.snapshot().totals;
    expect(t.subtotal.amount).toBe(500_000);
    expect(t.discount.amount).toBe(0);
    expect(t.deliveryFee.amount).toBe(50_000);
    expect(t.total.amount).toBe(550_000);
    expect(order.status).toBe('draft');
    expect(order.snapshot().delivery?.zoneId).toBe('z1');
  });

  it('applies promo discount capped by subtotal and free delivery threshold', () => {
    const order = Order.create(input({ items: [item(600_000, 2)], promoEffect: { discount: Money.of(5_000_000), freeDelivery: false } }), NOW);
    const t = order.snapshot().totals;
    expect(t.discount.amount).toBe(1_200_000);
    expect(t.deliveryFee.amount).toBe(0);
    expect(t.total.amount).toBe(0);
  });

  it('rejects an order below the zone minimum', () => {
    expect(() => Order.create(input({ items: [item(100_000)] }), NOW)).toThrow(
      expect.objectContaining({ code: 'order.min_order_not_reached' }),
    );
  });

  it('requires delivery details for delivery and forbids them for pickup', () => {
    expect(() => Order.create(input({ zone: null }), NOW)).toThrow(expect.objectContaining({ code: 'order.delivery_required' }));
    const pickup = input({ type: 'pickup' });
    expect(() => Order.create({ ...pickup, delivery: input().delivery }, NOW)).toThrow(
      expect.objectContaining({ code: 'order.delivery_not_allowed' }),
    );
  });

  it('rejects empty orders and inconsistent line totals', () => {
    expect(() => Order.create(input({ items: [] }), NOW)).toThrow(expect.objectContaining({ code: 'order.empty' }));
    const bad = { ...item(100_000, 2), lineTotal: Money.of(1) };
    expect(() => Order.create(input({ items: [bad] }), NOW)).toThrow(expect.objectContaining({ code: 'order.line_total_mismatch' }));
  });

  it('promises ASAP time from placement and moves it on acceptance', () => {
    const order = Order.create(input({ etaMinutes: 60 }), NOW);
    expect(order.snapshot().promisedAt.toISOString()).toBe('2026-10-01T09:00:00.000Z');
    order.submit(NOW);
    order.markPaid(NOW);
    order.accept(new Date('2026-10-01T08:20:00.000Z'));
    expect(order.snapshot().promisedAt.toISOString()).toBe('2026-10-01T09:20:00.000Z');
  });

  it('keeps the scheduled time as the promised time', () => {
    const at = new Date('2026-10-01T14:00:00.000Z');
    const order = Order.create(input({ scheduledFor: at }), NOW);
    order.submit(NOW);
    order.markPaid(NOW);
    order.accept(NOW);
    expect(order.snapshot().promisedAt.toISOString()).toBe(at.toISOString());
  });

  it('anonymizes contacts but keeps amounts', () => {
    const order = orderIn('completed');
    order.anonymize();
    const s = order.snapshot();
    expect(s.customer.phone).toBe('anonymized');
    expect(s.customer.name).toBeNull();
    expect(s.delivery?.addressText).toBe('anonymized');
    expect(s.totals.total.amount).toBe(550_000);
  });
});
