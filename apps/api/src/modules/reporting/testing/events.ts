/**
 * Тестовые события других модулей (payload строго по их публичным контрактам) — для интеграционных
 * тестов проекций и отчётов Reporting. В продакшен-коде не используется.
 */
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { newId } from '../../../shared/kernel/ids';
import { MoneyJson } from '../../../shared/kernel/money';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import {
  BanquetActIssuedPayload,
  BanquetEvents,
  BanquetInvoiceIssuedPayload,
  BanquetInvoicePaymentPayload,
  BanquetRequestCreatedPayload,
  BanquetStatus,
  BanquetStatusChangedPayload,
} from '../../banquet/public';
import {
  OrderCancelledPayload,
  OrderCompletedPayload,
  OrderEventItem,
  OrderingEvents,
  OrderPlacedPayload,
  OrderStatus,
  OrderStatusChangedPayload,
} from '../../ordering/public';
import {
  CertificateExpiredPayload,
  CertificateIssuedPayload,
  CertificateRedeemedPayload,
  PaymentEventPayload,
  PaymentMethod,
  PaymentPurpose,
  PaymentsEvents,
  RefundEventPayload,
} from '../../payments/public';
import {
  ReservationCreatedPayload,
  ReservationEvents,
  ReservationRescheduledPayload,
  ReservationStatus,
  ReservationStatusChangedPayload,
} from '../../reservation/public';

export const kzt = (amount: number): MoneyJson => ({ amount, currency: 'KZT' });

/** Момент по локальному времени Asia/Almaty. */
export const local = (date: string, time: string): Date => zonedTimeToUtc(date, time);

export interface TestOrder {
  orderId: string;
  number: string;
  branchId: string;
  type: 'delivery' | 'pickup';
  channel: 'web' | 'admin';
  items: OrderEventItem[];
  subtotal: number;
  discount: number;
  deliveryFee: number;
  total: number;
  analyticsSessionId: string | null;
  paymentMethod: 'online' | 'on_receipt';
}

let seq = 0;

export function testOrder(
  branchId: string,
  lines: Array<{ dishId: string; name: string; quantity: number; unitPrice: number }>,
  overrides: Partial<Omit<TestOrder, 'items'>> = {},
): TestOrder {
  seq++;
  const items = lines.map((l) => ({
    dishId: l.dishId,
    name: { ru: l.name, kk: l.name },
    quantity: l.quantity,
    unitPrice: kzt(l.unitPrice),
    lineTotal: kzt(l.unitPrice * l.quantity),
  }));
  const subtotal = items.reduce((a, i) => a + i.lineTotal.amount, 0);
  const discount = overrides.discount ?? 0;
  const deliveryFee = overrides.deliveryFee ?? 0;
  return {
    orderId: newId(),
    number: `T-2026-${String(seq).padStart(6, '0')}`,
    branchId,
    type: 'delivery',
    channel: 'web',
    items,
    subtotal,
    discount,
    deliveryFee,
    total: subtotal - discount + deliveryFee,
    analyticsSessionId: null,
    paymentMethod: 'online',
    ...overrides,
  };
}

const customer = { customerId: null, phone: '+77010000000', name: 'Гость' };

export class ReportingEvents {
  constructor(private readonly bus: EventBus) {}

  async orderPlaced(o: TestOrder, at: Date, status: OrderStatus = 'awaiting_payment'): Promise<void> {
    await this.bus.publish(
      OrderingEvents.OrderPlaced,
      {
        orderId: o.orderId,
        number: o.number,
        branchId: o.branchId,
        type: o.type,
        channel: o.channel,
        status,
        customer,
        items: o.items,
        subtotal: kzt(o.subtotal),
        discount: kzt(o.discount),
        deliveryFee: kzt(o.deliveryFee),
        total: kzt(o.total),
        paymentMethod: o.paymentMethod,
        promoCode: null,
        scheduledFor: null,
        analyticsSessionId: o.analyticsSessionId,
        locale: 'ru',
        publicToken: 'token',
        occurredAt: at.toISOString(),
      } satisfies OrderPlacedPayload,
      { aggregateId: o.orderId, branchId: o.branchId },
    );
  }

  async orderStatus(o: TestOrder, from: OrderStatus, to: OrderStatus, at: Date): Promise<void> {
    await this.bus.publish(
      OrderingEvents.OrderStatusChanged,
      {
        orderId: o.orderId,
        number: o.number,
        branchId: o.branchId,
        type: o.type,
        channel: o.channel,
        from,
        to,
        reason: null,
        customer,
        total: kzt(o.total),
        locale: 'ru',
        publicToken: 'token',
        occurredAt: at.toISOString(),
      } satisfies OrderStatusChangedPayload,
      { aggregateId: o.orderId, branchId: o.branchId },
    );
  }

  async orderCompleted(o: TestOrder, placedAt: Date, completedAt: Date): Promise<void> {
    await this.bus.publish(
      OrderingEvents.OrderCompleted,
      {
        orderId: o.orderId,
        number: o.number,
        branchId: o.branchId,
        type: o.type,
        channel: o.channel,
        customer,
        items: o.items,
        subtotal: kzt(o.subtotal),
        discount: kzt(o.discount),
        deliveryFee: kzt(o.deliveryFee),
        total: kzt(o.total),
        placedAt: placedAt.toISOString(),
        completedAt: completedAt.toISOString(),
      } satisfies OrderCompletedPayload,
      { aggregateId: o.orderId, branchId: o.branchId },
    );
  }

  async orderCancelled(o: TestOrder, at: Date, reasonCode: string, wasPaid: boolean, reason: string | null = null): Promise<void> {
    await this.bus.publish(
      OrderingEvents.OrderCancelled,
      {
        orderId: o.orderId,
        number: o.number,
        branchId: o.branchId,
        type: o.type,
        channel: o.channel,
        customer,
        total: kzt(o.total),
        reasonCode,
        reason,
        wasPaid,
        cancelledAt: at.toISOString(),
      } satisfies OrderCancelledPayload,
      { aggregateId: o.orderId, branchId: o.branchId },
    );
  }

  async paymentSucceeded(p: {
    paymentId?: string;
    purpose: PaymentPurpose;
    referenceId: string;
    branchId: string | null;
    method: PaymentMethod;
    provider?: string;
    amount: number;
    at: Date;
  }): Promise<string> {
    const paymentId = p.paymentId ?? newId();
    await this.bus.publish(
      PaymentsEvents.PaymentSucceeded,
      {
        paymentId,
        purpose: p.purpose,
        referenceId: p.referenceId,
        branchId: p.branchId,
        method: p.method,
        provider: p.provider ?? (p.method === 'online' ? 'sandbox' : p.method),
        amount: kzt(p.amount),
        occurredAt: p.at.toISOString(),
      } satisfies PaymentEventPayload,
      { aggregateId: paymentId, branchId: p.branchId },
    );
    return paymentId;
  }

  async refundSucceeded(r: {
    refundId?: string;
    paymentId: string;
    purpose: PaymentPurpose;
    referenceId: string;
    branchId: string | null;
    amount: number;
    at: Date;
  }): Promise<string> {
    const refundId = r.refundId ?? newId();
    await this.bus.publish(
      PaymentsEvents.RefundSucceeded,
      {
        refundId,
        paymentId: r.paymentId,
        purpose: r.purpose,
        referenceId: r.referenceId,
        branchId: r.branchId,
        amount: kzt(r.amount),
        paymentFullyRefunded: false,
        referenceFullyRefunded: false,
        reason: 'test',
        occurredAt: r.at.toISOString(),
      } satisfies RefundEventPayload,
      { aggregateId: r.paymentId, branchId: r.branchId },
    );
    return refundId;
  }

  async reservationCreated(r: {
    reservationId?: string;
    branchId: string;
    venueId: string;
    venueTypeCode?: string;
    kind?: 'regular' | 'banquet';
    status?: ReservationStatus;
    start: Date;
    end: Date;
    guests: number;
    at: Date;
  }): Promise<string> {
    const reservationId = r.reservationId ?? newId();
    await this.bus.publish(
      ReservationEvents.ReservationCreated,
      {
        reservationId,
        number: `R-${reservationId.slice(-6)}`,
        branchId: r.branchId,
        venueId: r.venueId,
        venueName: { ru: 'VIP-зал' },
        venueTypeCode: r.venueTypeCode ?? 'vip',
        kind: r.kind ?? 'regular',
        status: r.status ?? 'confirmed',
        start: r.start.toISOString(),
        end: r.end.toISOString(),
        guests: r.guests,
        customer: { customerId: null, phone: '+77010000000', name: 'Гость' },
        deposit: null,
        banquetRequestId: null,
        source: 'web',
        locale: 'ru',
        publicToken: null,
        occurredAt: r.at.toISOString(),
      } satisfies ReservationCreatedPayload,
      { aggregateId: reservationId, branchId: r.branchId },
    );
    return reservationId;
  }

  async reservationStatus(r: {
    reservationId: string;
    branchId: string;
    venueId: string;
    venueTypeCode?: string;
    from: ReservationStatus;
    to: ReservationStatus;
    start: Date;
    end: Date;
    guests: number;
    at: Date;
  }): Promise<void> {
    await this.bus.publish(
      ReservationEvents.ReservationStatusChanged,
      {
        reservationId: r.reservationId,
        number: `R-${r.reservationId.slice(-6)}`,
        branchId: r.branchId,
        venueId: r.venueId,
        venueTypeCode: r.venueTypeCode ?? 'vip',
        kind: 'regular',
        from: r.from,
        to: r.to,
        start: r.start.toISOString(),
        end: r.end.toISOString(),
        guests: r.guests,
        customer: { customerId: null, phone: '+77010000000', name: 'Гость' },
        deposit: null,
        depositOutcome: 'none',
        reason: null,
        locale: 'ru',
        publicToken: null,
        occurredAt: r.at.toISOString(),
      } satisfies ReservationStatusChangedPayload,
      { aggregateId: r.reservationId, branchId: r.branchId },
    );
  }

  async reservationRescheduled(r: {
    reservationId: string;
    branchId: string;
    from: { venueId: string; start: Date; end: Date; guests: number };
    to: { venueId: string; start: Date; end: Date; guests: number };
    at: Date;
  }): Promise<void> {
    const slot = (s: { venueId: string; start: Date; end: Date; guests: number }) => ({
      venueId: s.venueId,
      venueName: { ru: 'VIP-зал' },
      venueTypeCode: 'vip',
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      guests: s.guests,
    });
    await this.bus.publish(
      ReservationEvents.ReservationRescheduled,
      {
        reservationId: r.reservationId,
        number: `R-${r.reservationId.slice(-6)}`,
        branchId: r.branchId,
        kind: 'regular',
        status: 'confirmed',
        from: slot(r.from),
        to: slot(r.to),
        customer: { customerId: null, phone: '+77010000000', name: 'Гость' },
        banquetRequestId: null,
        reason: null,
        locale: 'ru',
        publicToken: null,
        occurredAt: r.at.toISOString(),
      } satisfies ReservationRescheduledPayload,
      { aggregateId: r.reservationId, branchId: r.branchId },
    );
  }

  async banquetCreated(b: { requestId?: string; branchId: string | null; at: Date; guests?: number }): Promise<string> {
    const requestId = b.requestId ?? newId();
    await this.bus.publish(
      BanquetEvents.RequestCreated,
      {
        requestId,
        number: `B-${requestId.slice(-6)}`,
        branchId: b.branchId,
        isOffsite: b.branchId === null,
        eventDate: '2026-10-20',
        eventType: 'wedding',
        guests: b.guests ?? 40,
        budget: kzt(50_000_000),
        managerId: newId(),
        contact: { customerId: null, name: 'Клиент', phone: '+77010000001', email: null },
        source: 'web',
        occurredAt: b.at.toISOString(),
      } satisfies BanquetRequestCreatedPayload,
      { aggregateId: requestId, branchId: b.branchId },
    );
    return requestId;
  }

  async banquetStatus(b: {
    requestId: string;
    branchId: string | null;
    from: BanquetStatus;
    to: BanquetStatus;
    at: Date;
    quoteTotal?: number | null;
    reason?: string | null;
  }): Promise<void> {
    await this.bus.publish(
      BanquetEvents.StatusChanged,
      {
        requestId: b.requestId,
        number: `B-${b.requestId.slice(-6)}`,
        branchId: b.branchId,
        isOffsite: b.branchId === null,
        from: b.from,
        to: b.to,
        managerId: newId(),
        eventDate: '2026-10-20',
        guests: 40,
        quoteTotal: b.quoteTotal ? kzt(b.quoteTotal) : null,
        contact: { customerId: null, name: 'Клиент', phone: '+77010000001', email: null },
        reason: b.reason ?? null,
        occurredAt: b.at.toISOString(),
      } satisfies BanquetStatusChangedPayload,
      { aggregateId: b.requestId, branchId: b.branchId },
    );
  }

  async invoiceIssued(i: {
    invoiceId?: string;
    number: string;
    requestId: string;
    branchId: string | null;
    company: { name: string; bin: string } | null;
    amount: number;
    at: Date;
  }): Promise<string> {
    const invoiceId = i.invoiceId ?? newId();
    await this.bus.publish(
      BanquetEvents.InvoiceIssued,
      {
        invoiceId,
        number: i.number,
        requestId: i.requestId,
        branchId: i.branchId,
        payerType: i.company ? 'company' : 'individual',
        company: i.company,
        amount: kzt(i.amount),
        dueDate: '2026-10-15',
        occurredAt: i.at.toISOString(),
      } satisfies BanquetInvoiceIssuedPayload,
      { aggregateId: i.requestId, branchId: i.branchId },
    );
    return invoiceId;
  }

  async invoicePayment(p: { invoiceId: string; requestId: string; branchId: string | null; paymentId: string; amount: number; paidTotal: number; invoiceAmount: number; at: Date }) {
    await this.bus.publish(
      BanquetEvents.InvoicePaymentRecorded,
      {
        invoiceId: p.invoiceId,
        requestId: p.requestId,
        branchId: p.branchId,
        paymentId: p.paymentId,
        amount: kzt(p.amount),
        paidTotal: kzt(p.paidTotal),
        remaining: kzt(p.invoiceAmount - p.paidTotal),
        fullyPaid: p.paidTotal >= p.invoiceAmount,
        occurredAt: p.at.toISOString(),
      } satisfies BanquetInvoicePaymentPayload,
      { aggregateId: p.requestId, branchId: p.branchId },
    );
  }

  async actIssued(a: { number: string; requestId: string; branchId: string | null; company: { name: string; bin: string } | null; amount: number; vat: number; at: Date }) {
    const actId = newId();
    await this.bus.publish(
      BanquetEvents.ActIssued,
      {
        actId,
        number: a.number,
        requestId: a.requestId,
        branchId: a.branchId,
        amount: kzt(a.amount),
        vatAmount: kzt(a.vat),
        company: a.company,
        occurredAt: a.at.toISOString(),
      } satisfies BanquetActIssuedPayload,
      { aggregateId: a.requestId, branchId: a.branchId },
    );
    return actId;
  }

  async certificateIssued(c: { certificateId?: string; nominal: number; price: number; at: Date; kind?: 'amount' | 'set' }): Promise<string> {
    const certificateId = c.certificateId ?? newId();
    await this.bus.publish(
      PaymentsEvents.CertificateIssued,
      {
        certificateId,
        productId: newId(),
        kind: c.kind ?? 'amount',
        nominal: kzt(c.nominal),
        price: kzt(c.price),
        buyerPhone: '+77010000002',
        branchId: null,
        occurredAt: c.at.toISOString(),
      } satisfies CertificateIssuedPayload,
      { aggregateId: certificateId },
    );
    return certificateId;
  }

  async certificateRedeemed(c: { certificateId: string; amount: number; balanceAfter: number; branchId: string | null; at: Date }) {
    await this.bus.publish(
      PaymentsEvents.CertificateRedeemed,
      {
        certificateId: c.certificateId,
        amount: kzt(c.amount),
        balanceAfter: kzt(c.balanceAfter),
        branchId: c.branchId,
        channel: 'point',
        referenceId: null,
        occurredAt: c.at.toISOString(),
      } satisfies CertificateRedeemedPayload,
      { aggregateId: c.certificateId, branchId: c.branchId },
    );
  }

  async certificateExpired(c: { certificateId: string; nominal: number; balance: number; at: Date }) {
    await this.bus.publish(
      PaymentsEvents.CertificateExpired,
      {
        certificateId: c.certificateId,
        kind: 'amount',
        nominal: kzt(c.nominal),
        balance: kzt(c.balance),
        expiresAt: c.at.toISOString(),
        occurredAt: c.at.toISOString(),
      } satisfies CertificateExpiredPayload,
      { aggregateId: c.certificateId },
    );
  }
}
