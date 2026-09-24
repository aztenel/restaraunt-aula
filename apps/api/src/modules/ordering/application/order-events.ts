import { Order, OrderTransition } from '../domain/order';
import {
  OrderCancelledPayload,
  OrderCompletedPayload,
  OrderEventCustomer,
  OrderEventItem,
  OrderPlacedPayload,
  OrderStatusChangedPayload,
} from '../public';

/** Построение payload событий Ordering (только JSON-совместимые данные: деньги — MoneyJson, даты — ISO). */
export function eventCustomer(order: Order): OrderEventCustomer {
  const c = order.snapshot().customer;
  return { customerId: c.customerId, phone: c.phone, name: c.name };
}

export function eventItems(order: Order): OrderEventItem[] {
  return order.snapshot().items.map((i) => ({
    dishId: i.dishId,
    name: i.name,
    quantity: i.quantity,
    unitPrice: i.unitPrice.toJSON(),
    lineTotal: i.lineTotal.toJSON(),
  }));
}

export function orderPlacedPayload(order: Order, occurredAt: Date): OrderPlacedPayload {
  const s = order.snapshot();
  return {
    orderId: s.id,
    number: s.number,
    branchId: s.branchId,
    type: s.type,
    channel: s.channel,
    status: s.status,
    customer: eventCustomer(order),
    items: eventItems(order),
    subtotal: s.totals.subtotal.toJSON(),
    discount: s.totals.discount.toJSON(),
    deliveryFee: s.totals.deliveryFee.toJSON(),
    total: s.totals.total.toJSON(),
    paymentMethod: s.paymentMethod,
    promoCode: s.promo?.code ?? null,
    scheduledFor: s.scheduledFor?.toISOString() ?? null,
    analyticsSessionId: s.analyticsSessionId,
    locale: s.locale,
    publicToken: s.publicToken,
    occurredAt: occurredAt.toISOString(),
  };
}

export function statusChangedPayload(order: Order, t: OrderTransition): OrderStatusChangedPayload {
  const s = order.snapshot();
  return {
    orderId: s.id,
    number: s.number,
    branchId: s.branchId,
    type: s.type,
    channel: s.channel,
    from: t.from,
    to: t.to,
    reason: t.reasonCode ? [t.reasonCode, t.reason].filter(Boolean).join(': ') : t.reason,
    customer: eventCustomer(order),
    total: s.totals.total.toJSON(),
    locale: s.locale,
    publicToken: s.publicToken,
    occurredAt: t.at.toISOString(),
  };
}

export function orderCompletedPayload(order: Order, completedAt: Date): OrderCompletedPayload {
  const s = order.snapshot();
  return {
    orderId: s.id,
    number: s.number,
    branchId: s.branchId,
    type: s.type,
    channel: s.channel,
    customer: eventCustomer(order),
    items: eventItems(order),
    subtotal: s.totals.subtotal.toJSON(),
    discount: s.totals.discount.toJSON(),
    deliveryFee: s.totals.deliveryFee.toJSON(),
    total: s.totals.total.toJSON(),
    placedAt: s.timestamps.placedAt.toISOString(),
    completedAt: completedAt.toISOString(),
  };
}

export function orderCancelledPayload(order: Order, cancelledAt: Date): OrderCancelledPayload {
  const s = order.snapshot();
  return {
    orderId: s.id,
    number: s.number,
    branchId: s.branchId,
    type: s.type,
    channel: s.channel,
    customer: eventCustomer(order),
    total: s.totals.total.toJSON(),
    reasonCode: s.cancellation?.reasonCode ?? 'other',
    reason: s.cancellation?.reason ?? null,
    wasPaid: s.wasPaid,
    cancelledAt: cancelledAt.toISOString(),
  };
}
