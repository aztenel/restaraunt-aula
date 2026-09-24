import { Money } from '../../../shared/kernel/money';
import { localDateOf } from './period';

/**
 * Правила признания выручки (docs/decisions.md, «Отчётность»):
 * - заказ — при переходе в completed (итог заказа), канал = тип заказа (доставка / самовывоз);
 * - банкет — при переходе в held (итог актуальной сметы);
 * - подарочный сертификат — при продаже (цена продажи);
 * - возврат уменьшает выручку дня возврата, если выручка по объекту уже признана
 *   (возврат по отменённому заказу/банкету выручку не меняет — её не было);
 * - депозит брони — не выручка каналов (засчитывается в счёт на точке), виден в отчёте по поступлениям.
 * Поступления денег (платежи) — отдельный отчёт «Движение денег».
 */
export const SalesChannel = {
  Delivery: 'delivery',
  Pickup: 'pickup',
  Banquet: 'banquet',
  Certificate: 'certificate',
} as const;
export type SalesChannel = (typeof SalesChannel)[keyof typeof SalesChannel];
export const SALES_CHANNELS: readonly SalesChannel[] = Object.values(SalesChannel);

export const SalesFactKind = { Sale: 'sale', Refund: 'refund' } as const;
export type SalesFactKind = (typeof SalesFactKind)[keyof typeof SalesFactKind];

/** Источник строки выручки: одна строка на источник (идемпотентность проекции). */
export const SalesSourceType = { Order: 'order', Banquet: 'banquet', Certificate: 'certificate', Refund: 'refund' } as const;
export type SalesSourceType = (typeof SalesSourceType)[keyof typeof SalesSourceType];

export type OrderTypeCode = 'delivery' | 'pickup';
export type OrderChannelCode = 'web' | 'admin';
export type PaymentPurposeCode = 'order' | 'reservation_deposit' | 'banquet_invoice' | 'gift_certificate';

export interface SalesFact {
  sourceType: SalesSourceType;
  sourceId: string;
  kind: SalesFactKind;
  channel: SalesChannel;
  branchId: string | null;
  orderChannel: OrderChannelCode | null;
  referenceId: string;
  occurredAt: Date;
  localDate: string;
  amount: Money;
}

export function orderSalesChannel(type: OrderTypeCode): SalesChannel {
  return type === 'pickup' ? SalesChannel.Pickup : SalesChannel.Delivery;
}

/** Выручка по выполненному заказу. */
export function orderSale(order: {
  orderId: string;
  type: OrderTypeCode;
  channel: OrderChannelCode;
  branchId: string;
  total: Money;
  completedAt: Date;
}): SalesFact {
  return {
    sourceType: SalesSourceType.Order,
    sourceId: order.orderId,
    kind: SalesFactKind.Sale,
    channel: orderSalesChannel(order.type),
    branchId: order.branchId,
    orderChannel: order.channel,
    referenceId: order.orderId,
    occurredAt: order.completedAt,
    localDate: localDateOf(order.completedAt),
    amount: order.total.clampToZero(),
  };
}

/** Выручка по проведённому банкету (итог сметы; без сметы — ноль, но банкет учитывается в количестве). */
export function banquetSale(banquet: { requestId: string; branchId: string | null; total: Money | null; heldAt: Date }): SalesFact {
  return {
    sourceType: SalesSourceType.Banquet,
    sourceId: banquet.requestId,
    kind: SalesFactKind.Sale,
    channel: SalesChannel.Banquet,
    branchId: banquet.branchId,
    orderChannel: null,
    referenceId: banquet.requestId,
    occurredAt: banquet.heldAt,
    localDate: localDateOf(banquet.heldAt),
    amount: (banquet.total ?? Money.zero()).clampToZero(),
  };
}

/** Выручка по проданному сертификату (цена продажи). */
export function certificateSale(certificate: { certificateId: string; branchId: string | null; price: Money; issuedAt: Date }): SalesFact {
  return {
    sourceType: SalesSourceType.Certificate,
    sourceId: certificate.certificateId,
    kind: SalesFactKind.Sale,
    channel: SalesChannel.Certificate,
    branchId: certificate.branchId,
    orderChannel: null,
    referenceId: certificate.certificateId,
    occurredAt: certificate.issuedAt,
    localDate: localDateOf(certificate.issuedAt),
    amount: certificate.price.clampToZero(),
  };
}

export interface RefundFactInput {
  refundId: string;
  purpose: PaymentPurposeCode;
  referenceId: string;
  branchId: string | null;
  amount: Money;
  refundedAt: Date;
}

/** Состояние объекта возврата в проекциях (что известно на момент обработки). */
export interface RefundTarget {
  order?: { orderId: string; type: OrderTypeCode; channel: OrderChannelCode; branchId: string; completedAt: Date | null } | null;
  banquet?: { requestId: string; branchId: string | null; heldAt: Date | null } | null;
}

/**
 * Отрицательная строка выручки по возврату — или null, если возврат выручку не меняет.
 * Возврат считается возвратом признанной выручки, если произошёл не раньше признания
 * (частичный возврат по выполненному заказу, возврат по проведённому банкету, возврат покупки сертификата).
 */
export function refundRevenueFact(refund: RefundFactInput, target: RefundTarget): SalesFact | null {
  const base = {
    sourceType: SalesSourceType.Refund,
    sourceId: refund.refundId,
    kind: SalesFactKind.Refund,
    occurredAt: refund.refundedAt,
    localDate: localDateOf(refund.refundedAt),
    amount: refund.amount.clampToZero().negate(),
  };
  switch (refund.purpose) {
    case 'order': {
      const order = target.order;
      if (!order?.completedAt || refund.refundedAt < order.completedAt) return null;
      return {
        ...base,
        channel: orderSalesChannel(order.type),
        branchId: order.branchId,
        orderChannel: order.channel,
        referenceId: order.orderId,
      };
    }
    case 'banquet_invoice': {
      const banquet = target.banquet;
      if (!banquet?.heldAt || refund.refundedAt < banquet.heldAt) return null;
      return { ...base, channel: SalesChannel.Banquet, branchId: banquet.branchId, orderChannel: null, referenceId: banquet.requestId };
    }
    case 'gift_certificate':
      return { ...base, channel: SalesChannel.Certificate, branchId: refund.branchId, orderChannel: null, referenceId: refund.referenceId };
    default:
      return null;
  }
}

/**
 * Ранги статусов для проекций: события могут прийти не по порядку, применяется статус
 * с более поздним временем; при равном времени (два перехода в одной транзакции) — с большим рангом.
 */
export const ORDER_STATUS_RANK: Readonly<Record<string, number>> = {
  draft: 0,
  awaiting_payment: 1,
  paid: 2,
  accepted: 3,
  cooking: 4,
  ready: 5,
  delivering: 6,
  completed: 7,
  cancelled: 7,
  refunded: 8,
};

export const RESERVATION_STATUS_RANK: Readonly<Record<string, number>> = {
  pending: 0,
  awaiting_deposit: 0,
  confirmed: 1,
  arrived: 2,
  no_show: 2,
  cancelled: 2,
  expired: 2,
};

export const BANQUET_STATUS_RANK: Readonly<Record<string, number>> = {
  new: 0,
  in_progress: 1,
  quote_sent: 2,
  agreed: 3,
  prepaid: 4,
  held: 5,
  cancelled: 6,
};

/** Новее ли входящий статус текущего (время, затем ранг). */
export function isNewerStatus(current: { at: Date; rank: number } | null, incoming: { at: Date; rank: number }): boolean {
  if (!current) return true;
  if (incoming.at.getTime() !== current.at.getTime()) return incoming.at > current.at;
  return incoming.rank >= current.rank;
}

/** Выручка по каналам: суммы нетто (продажи + возвраты), возвраты отдельно (≤ 0), итог. */
export interface ChannelAmounts {
  delivery: Money;
  pickup: Money;
  banquet: Money;
  certificate: Money;
  /** Возвраты признанной выручки (отрицательная сумма), уже учтены в каналах. */
  refunds: Money;
  total: Money;
}

export function emptyChannelAmounts(): ChannelAmounts {
  return {
    delivery: Money.zero(),
    pickup: Money.zero(),
    banquet: Money.zero(),
    certificate: Money.zero(),
    refunds: Money.zero(),
    total: Money.zero(),
  };
}

/** Добавить продажи и возвраты канала (возвраты — отрицательная сумма). */
export function addChannelAmount(acc: ChannelAmounts, channel: SalesChannel, sales: Money, refunds: Money): ChannelAmounts {
  const net = sales.add(refunds);
  return { ...acc, [channel]: acc[channel].add(net), refunds: acc.refunds.add(refunds), total: acc.total.add(net) };
}
