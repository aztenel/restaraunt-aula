/**
 * Публичный контракт модуля Ordering: заказы доставки и самовывоза, зоны доставки, промокоды.
 * Жизненный цикл заказа — конечный автомат строго по схеме ТЗ (см. OrderStatus и ORDER_TRANSITIONS
 * в ordering/domain).
 */
import { MoneyJson } from '../../../shared/kernel/money';
import { Locale, Translatable } from '../../../shared/kernel/translatable';

export const OrderStatus = {
  Draft: 'draft',
  AwaitingPayment: 'awaiting_payment',
  Paid: 'paid',
  Accepted: 'accepted',
  Cooking: 'cooking',
  Ready: 'ready',
  Delivering: 'delivering',
  Completed: 'completed',
  Cancelled: 'cancelled',
  Refunded: 'refunded',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const OrderType = { Delivery: 'delivery', Pickup: 'pickup' } as const;
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** Откуда пришёл заказ: свой сайт или оператор по телефону (админка). */
export const OrderChannel = { Web: 'web', Admin: 'admin' } as const;
export type OrderChannel = (typeof OrderChannel)[keyof typeof OrderChannel];

export interface OrderEventCustomer {
  customerId: string | null;
  phone: string;
  name: string | null;
}

export interface OrderEventItem {
  dishId: string;
  name: Translatable;
  quantity: number;
  unitPrice: MoneyJson;
  lineTotal: MoneyJson;
}

export const OrderingEvents = {
  OrderPlaced: 'ordering.order_placed',
  OrderStatusChanged: 'ordering.order_status_changed',
  OrderCompleted: 'ordering.order_completed',
  OrderCancelled: 'ordering.order_cancelled',
} as const;

export interface OrderPlacedPayload {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  customer: OrderEventCustomer;
  items: OrderEventItem[];
  subtotal: MoneyJson;
  discount: MoneyJson;
  deliveryFee: MoneyJson;
  total: MoneyJson;
  paymentMethod: 'online' | 'on_receipt';
  promoCode: string | null;
  scheduledFor: string | null;
  analyticsSessionId: string | null;
  locale: Locale;
  publicToken: string;
  occurredAt: string;
}

export interface OrderStatusChangedPayload {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  from: OrderStatus;
  to: OrderStatus;
  reason: string | null;
  customer: OrderEventCustomer;
  total: MoneyJson;
  locale: Locale;
  publicToken: string;
  occurredAt: string;
}

export interface OrderCompletedPayload {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  customer: OrderEventCustomer;
  items: OrderEventItem[];
  subtotal: MoneyJson;
  discount: MoneyJson;
  deliveryFee: MoneyJson;
  total: MoneyJson;
  placedAt: string;
  completedAt: string;
}

export interface OrderCancelledPayload {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  customer: OrderEventCustomer;
  total: MoneyJson;
  /** Код причины: guest_request, not_paid_in_time, out_of_stock, cannot_deliver, duplicate, other. */
  reasonCode: string;
  reason: string | null;
  wasPaid: boolean;
  cancelledAt: string;
}

/** Заказ для передачи на кухню (POS). */
export interface KitchenOrder {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderType;
  status: OrderStatus;
  items: Array<{
    dishId: string;
    sku: string | null;
    name: Translatable;
    quantity: number;
    modifiers: Array<{ optionId: string; name: Translatable }>;
    unitPrice: MoneyJson;
  }>;
  comment: string | null;
  scheduledFor: string | null;
  customer: { name: string | null; phone: string };
  deliveryAddress: string | null;
  total: MoneyJson;
  paymentMethod: 'online' | 'on_receipt';
  isPaidOnline: boolean;
  placedAt: string;
}

export abstract class OrderQuery {
  abstract getKitchenOrder(orderId: string): Promise<KitchenOrder>;
}
