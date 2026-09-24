import { InvariantViolationError } from '../../../shared/kernel/errors';
import { Money, MoneyJson } from '../../../shared/kernel/money';
import { Locale } from '../../../shared/kernel/translatable';
import type {
  BanquetInvoiceIssuedPayload,
  BanquetRequestCreatedPayload,
  BanquetStatus,
  BanquetStatusChangedPayload,
} from '../../banquet/public';
import type { OrderCancelledPayload, OrderCompletedPayload, OrderPlacedPayload } from '../../ordering/public';
import type { CertificateIssuedPayload, RefundEventPayload } from '../../payments/public';
import type { ReservationCreatedPayload, ReservationStatus, ReservationStatusChangedPayload } from '../../reservation/public';
import { CustomerTag } from '../public';

/**
 * История гостя — проекция событий модулей (заказы, брони, банкеты, сертификаты).
 * Каждое событие превращается в строку истории + изменение агрегатов карточки + автотеги.
 * Суммы за период считаются из строк истории (counts_as_spent).
 */
export const ActivityType = {
  OrderPlaced: 'order_placed',
  OrderCompleted: 'order_completed',
  OrderCancelled: 'order_cancelled',
  OrderRefunded: 'order_refunded',
  ReservationCreated: 'reservation_created',
  ReservationArrived: 'reservation_arrived',
  ReservationNoShow: 'reservation_no_show',
  ReservationCancelled: 'reservation_cancelled',
  ReservationExpired: 'reservation_expired',
  ReservationStatusChanged: 'reservation_status_changed',
  BanquetRequested: 'banquet_requested',
  BanquetStatusChanged: 'banquet_status_changed',
  BanquetHeld: 'banquet_held',
  BanquetCancelled: 'banquet_cancelled',
  BanquetInvoiceIssued: 'banquet_invoice_issued',
  CertificatePurchased: 'certificate_purchased',
} as const;
export type ActivityType = (typeof ActivityType)[keyof typeof ActivityType];
export const ACTIVITY_TYPES = Object.values(ActivityType) as ActivityType[];

/** Автотег «постоянный гость» — от 3 выполненных заказов (decisions.md). */
export const REGULAR_MIN_COMPLETED_ORDERS = 3;

export interface CustomerAggregates {
  ordersCount: number;
  completedOrdersCount: number;
  totalSpent: Money;
  reservationsCount: number;
  noShowCount: number;
  banquetsCount: number;
}

export interface AggregateDelta {
  ordersCount?: number;
  completedOrdersCount?: number;
  /** Прибавка к сумме покупок, тиыны. */
  spent?: number;
  reservationsCount?: number;
  noShowCount?: number;
  banquetsCount?: number;
}

/** Ссылка на гостя из события: по id (если модуль уже знает гостя) или по телефону. */
export interface CustomerRef {
  customerId: string | null;
  phone: string | null;
  name: string | null;
  email: string | null;
  locale: Locale | null;
}

export interface ActivityDraft {
  type: ActivityType;
  entityType: 'order' | 'reservation' | 'banquet_request' | 'banquet_invoice' | 'gift_certificate';
  entityId: string;
  branchId: string | null;
  amount: MoneyJson | null;
  /** Строка учитывается в сумме покупок гостя (выручка признаётся: заказ — completed, банкет — held, сертификат — продажа). */
  countsAsSpent: boolean;
  summary: string;
  meta: Record<string, unknown>;
  occurredAt: Date;
  delta: AggregateDelta;
  /** Теги, которые событие добавляет независимо от агрегатов (например, corporate). */
  tags: string[];
}

export interface Projection {
  ref: CustomerRef;
  draft: ActivityDraft;
}

function moneyOrNull(value: MoneyJson | null | undefined): MoneyJson | null {
  return value ? Money.fromJson(value).toJSON() : null;
}

function date(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new InvariantViolationError('customers.event_date_invalid', `Invalid event date: ${value}`);
  }
  return d;
}

const ORDER_TYPE_RU: Record<string, string> = { delivery: 'доставка', pickup: 'самовывоз' };

export function fromOrderPlaced(p: OrderPlacedPayload): Projection {
  return {
    ref: { customerId: p.customer.customerId, phone: p.customer.phone, name: p.customer.name, email: null, locale: p.locale },
    draft: {
      type: ActivityType.OrderPlaced,
      entityType: 'order',
      entityId: p.orderId,
      branchId: p.branchId,
      amount: moneyOrNull(p.total),
      countsAsSpent: false,
      summary: `Заказ ${p.number} оформлен (${ORDER_TYPE_RU[p.type] ?? p.type})`,
      meta: { number: p.number, orderType: p.type, channel: p.channel, paymentMethod: p.paymentMethod, itemsCount: p.items.length },
      occurredAt: date(p.occurredAt),
      delta: { ordersCount: 1 },
      tags: [],
    },
  };
}

export function fromOrderCompleted(p: OrderCompletedPayload): Projection {
  const total = Money.fromJson(p.total);
  return {
    ref: { customerId: p.customer.customerId, phone: p.customer.phone, name: p.customer.name, email: null, locale: null },
    draft: {
      type: ActivityType.OrderCompleted,
      entityType: 'order',
      entityId: p.orderId,
      branchId: p.branchId,
      amount: total.toJSON(),
      countsAsSpent: true,
      summary: `Заказ ${p.number} выполнен`,
      meta: { number: p.number, orderType: p.type, channel: p.channel },
      occurredAt: date(p.completedAt),
      delta: { completedOrdersCount: 1, spent: total.amount },
      tags: [],
    },
  };
}

export function fromOrderCancelled(p: OrderCancelledPayload): Projection {
  return {
    ref: { customerId: p.customer.customerId, phone: p.customer.phone, name: p.customer.name, email: null, locale: null },
    draft: {
      type: ActivityType.OrderCancelled,
      entityType: 'order',
      entityId: p.orderId,
      branchId: p.branchId,
      amount: moneyOrNull(p.total),
      countsAsSpent: false,
      summary: `Заказ ${p.number} отменён`,
      meta: { number: p.number, reasonCode: p.reasonCode, reason: p.reason, wasPaid: p.wasPaid },
      occurredAt: date(p.cancelledAt),
      delta: {},
      tags: [],
    },
  };
}

/**
 * Возврат по выполненному заказу (недовложение): уменьшает сумму покупок гостя в день возврата.
 * Гость определяется по строке «заказ выполнен» (возвраты по невыполненным заказам сумму не меняют —
 * она учитывается только при выполнении).
 */
export function fromOrderRefund(p: RefundEventPayload): Omit<Projection, 'ref'> | null {
  if (p.purpose !== 'order') return null;
  const amount = Money.fromJson(p.amount);
  if (!amount.isPositive()) return null;
  return {
    draft: {
      type: ActivityType.OrderRefunded,
      entityType: 'order',
      entityId: p.referenceId,
      branchId: p.branchId,
      amount: amount.negate().toJSON(),
      countsAsSpent: true,
      summary: `Возврат по заказу: ${amount.toString()}`,
      meta: { refundId: p.refundId, paymentId: p.paymentId, reason: p.reason },
      occurredAt: date(p.occurredAt),
      delta: { spent: -amount.amount },
      tags: [],
    },
  };
}

/** Бронь под банкет (kind=banquet) в историю не пишется: её отражает банкетная заявка. */
export function fromReservationCreated(p: ReservationCreatedPayload): Projection | null {
  if (p.kind !== 'regular') return null;
  return {
    ref: { customerId: p.customer.customerId, phone: p.customer.phone, name: p.customer.name, email: null, locale: p.locale },
    draft: {
      type: ActivityType.ReservationCreated,
      entityType: 'reservation',
      entityId: p.reservationId,
      branchId: p.branchId,
      amount: moneyOrNull(p.deposit),
      countsAsSpent: false,
      summary: `Бронь ${p.number}: ${p.guests} гост.`,
      meta: { number: p.number, venueId: p.venueId, venueTypeCode: p.venueTypeCode, start: p.start, end: p.end, guests: p.guests, source: p.source },
      occurredAt: date(p.occurredAt),
      delta: { reservationsCount: 1 },
      tags: [],
    },
  };
}

const RESERVATION_OUTCOMES: Partial<Record<ReservationStatus, { type: ActivityType; label: string }>> = {
  arrived: { type: ActivityType.ReservationArrived, label: 'гости пришли' },
  no_show: { type: ActivityType.ReservationNoShow, label: 'гости не пришли' },
  cancelled: { type: ActivityType.ReservationCancelled, label: 'отменена' },
  expired: { type: ActivityType.ReservationExpired, label: 'не подтверждена вовремя' },
};

/**
 * Исходы брони. Счётчик неявок растёт при переходе в no_show; если отметку исправили
 * (из no_show в другой статус) — уменьшается.
 */
export function fromReservationStatusChanged(p: ReservationStatusChangedPayload): Projection | null {
  if (p.kind !== 'regular') return null;
  const noShowDelta = (p.to === 'no_show' ? 1 : 0) - (p.from === 'no_show' ? 1 : 0);
  const outcome =
    RESERVATION_OUTCOMES[p.to] ??
    (noShowDelta !== 0 ? { type: ActivityType.ReservationStatusChanged, label: `отметка исправлена (${p.to})` } : null);
  if (!outcome) return null;
  const { type, label } = outcome;
  return {
    ref: { customerId: p.customer.customerId, phone: p.customer.phone, name: p.customer.name, email: null, locale: p.locale },
    draft: {
      type,
      entityType: 'reservation',
      entityId: p.reservationId,
      branchId: p.branchId,
      amount: moneyOrNull(p.deposit),
      countsAsSpent: false,
      summary: `Бронь ${p.number}: ${label}`,
      meta: { number: p.number, from: p.from, to: p.to, depositOutcome: p.depositOutcome, reason: p.reason, start: p.start },
      occurredAt: date(p.occurredAt),
      delta: noShowDelta !== 0 ? { noShowCount: noShowDelta } : {},
      tags: [],
    },
  };
}

export function fromBanquetRequestCreated(p: BanquetRequestCreatedPayload): Projection {
  return {
    ref: { customerId: p.contact.customerId, phone: p.contact.phone, name: p.contact.name, email: p.contact.email, locale: null },
    draft: {
      type: ActivityType.BanquetRequested,
      entityType: 'banquet_request',
      entityId: p.requestId,
      branchId: p.branchId,
      amount: moneyOrNull(p.budget),
      countsAsSpent: false,
      summary: `Банкетная заявка ${p.number}: ${p.eventType}, ${p.guests} гост., ${p.eventDate}`,
      meta: { number: p.number, eventDate: p.eventDate, eventType: p.eventType, guests: p.guests, isOffsite: p.isOffsite, source: p.source },
      occurredAt: date(p.occurredAt),
      delta: { banquetsCount: 1 },
      tags: [CustomerTag.Banquet],
    },
  };
}

const BANQUET_STATUS_RU: Record<BanquetStatus, string> = {
  new: 'новая',
  in_progress: 'в работе',
  quote_sent: 'смета отправлена',
  agreed: 'согласована',
  prepaid: 'предоплата получена',
  held: 'проведено',
  cancelled: 'отменена',
};

/** Банкет проведён — итог сметы учитывается в сумме покупок гостя. */
export function fromBanquetStatusChanged(p: BanquetStatusChangedPayload): Projection {
  const held = p.to === 'held';
  const quoteTotal = moneyOrNull(p.quoteTotal);
  const spent = held && quoteTotal ? quoteTotal.amount : 0;
  const type = held ? ActivityType.BanquetHeld : p.to === 'cancelled' ? ActivityType.BanquetCancelled : ActivityType.BanquetStatusChanged;
  return {
    ref: { customerId: p.contact.customerId, phone: p.contact.phone, name: p.contact.name, email: p.contact.email, locale: null },
    draft: {
      type,
      entityType: 'banquet_request',
      entityId: p.requestId,
      branchId: p.branchId,
      amount: quoteTotal,
      countsAsSpent: held && quoteTotal !== null,
      summary: `Банкет ${p.number}: ${BANQUET_STATUS_RU[p.to] ?? p.to}`,
      meta: { number: p.number, from: p.from, to: p.to, eventDate: p.eventDate, guests: p.guests, reason: p.reason },
      occurredAt: date(p.occurredAt),
      delta: spent > 0 ? { spent } : {},
      tags: [],
    },
  };
}

/** Счёт по банкету. Счёт юрлицу — гость получает тег corporate. Гость находится по связи с заявкой. */
export function fromBanquetInvoiceIssued(p: BanquetInvoiceIssuedPayload): Omit<Projection, 'ref'> {
  const company = p.payerType === 'company' ? p.company : null;
  return {
    draft: {
      type: ActivityType.BanquetInvoiceIssued,
      entityType: 'banquet_invoice',
      entityId: p.invoiceId,
      branchId: p.branchId,
      amount: moneyOrNull(p.amount),
      countsAsSpent: false,
      summary: company ? `Счёт ${p.number} выставлен юрлицу ${company.name}` : `Счёт ${p.number} выставлен`,
      meta: { number: p.number, requestId: p.requestId, payerType: p.payerType, company, dueDate: p.dueDate },
      occurredAt: date(p.occurredAt),
      delta: {},
      tags: p.payerType === 'company' ? [CustomerTag.Corporate] : [],
    },
  };
}

/** Покупка сертификата (по телефону покупателя). Выручка по сертификату признаётся при продаже. */
export function fromCertificateIssued(p: CertificateIssuedPayload): Projection | null {
  if (!p.buyerPhone) return null;
  const price = Money.fromJson(p.price);
  return {
    ref: { customerId: null, phone: p.buyerPhone, name: null, email: null, locale: null },
    draft: {
      type: ActivityType.CertificatePurchased,
      entityType: 'gift_certificate',
      entityId: p.certificateId,
      branchId: p.branchId,
      amount: price.toJSON(),
      countsAsSpent: true,
      summary: `Подарочный сертификат на ${Money.fromJson(p.nominal).toString()}`,
      meta: { kind: p.kind, nominal: p.nominal, productId: p.productId },
      occurredAt: date(p.occurredAt),
      delta: { spent: price.amount },
      tags: [],
    },
  };
}

// ---------------------------------------------------------------- агрегаты и автотеги

export function emptyAggregates(): CustomerAggregates {
  return { ordersCount: 0, completedOrdersCount: 0, totalSpent: Money.zero(), reservationsCount: 0, noShowCount: 0, banquetsCount: 0 };
}

/** Применить изменение агрегатов. Счётчики не уходят в минус. */
export function applyDelta(a: CustomerAggregates, d: AggregateDelta): CustomerAggregates {
  const count = (value: number, delta = 0) => Math.max(0, value + delta);
  return {
    ordersCount: count(a.ordersCount, d.ordersCount),
    completedOrdersCount: count(a.completedOrdersCount, d.completedOrdersCount),
    totalSpent: a.totalSpent.add(Money.of(d.spent ?? 0, a.totalSpent.currency)).clampToZero(),
    reservationsCount: count(a.reservationsCount, d.reservationsCount),
    noShowCount: count(a.noShowCount, d.noShowCount),
    banquetsCount: count(a.banquetsCount, d.banquetsCount),
  };
}

/** Автотеги по агрегатам: regular — от 3 выполненных заказов, banquet — была банкетная заявка. */
export function autoTags(a: CustomerAggregates): string[] {
  const tags: string[] = [];
  if (a.completedOrdersCount >= REGULAR_MIN_COMPLETED_ORDERS) tags.push(CustomerTag.Regular);
  if (a.banquetsCount > 0) tags.push(CustomerTag.Banquet);
  return tags;
}

// ---------------------------------------------------------------- итоги за период

export interface ActivityTypeStat {
  type: ActivityType;
  count: number;
  /** Сумма строк с counts_as_spent, тиыны. */
  spentAmount: number;
}

export interface PeriodTotals {
  spent: Money;
  ordersPlaced: number;
  ordersCompleted: number;
  ordersCancelled: number;
  ordersRefunded: number;
  reservations: number;
  noShows: number;
  banquetRequests: number;
  banquetsHeld: number;
  certificatesPurchased: number;
  activities: number;
}

export function periodTotals(stats: readonly ActivityTypeStat[]): PeriodTotals {
  const count = (type: ActivityType) => stats.filter((s) => s.type === type).reduce((acc, s) => acc + s.count, 0);
  return {
    spent: Money.sum(stats.map((s) => Money.of(s.spentAmount))),
    ordersPlaced: count(ActivityType.OrderPlaced),
    ordersCompleted: count(ActivityType.OrderCompleted),
    ordersCancelled: count(ActivityType.OrderCancelled),
    ordersRefunded: count(ActivityType.OrderRefunded),
    reservations: count(ActivityType.ReservationCreated),
    noShows: count(ActivityType.ReservationNoShow),
    banquetRequests: count(ActivityType.BanquetRequested),
    banquetsHeld: count(ActivityType.BanquetHeld),
    certificatesPurchased: count(ActivityType.CertificatePurchased),
    activities: stats.reduce((acc, s) => acc + s.count, 0),
  };
}
