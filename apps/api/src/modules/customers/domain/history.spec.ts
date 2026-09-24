import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import type { BanquetInvoiceIssuedPayload, BanquetRequestCreatedPayload, BanquetStatusChangedPayload } from '../../banquet/public';
import type { OrderCancelledPayload, OrderCompletedPayload, OrderPlacedPayload } from '../../ordering/public';
import type { CertificateIssuedPayload, RefundEventPayload } from '../../payments/public';
import type { ReservationCreatedPayload, ReservationStatusChangedPayload } from '../../reservation/public';
import {
  ActivityType,
  applyDelta,
  autoTags,
  emptyAggregates,
  fromBanquetInvoiceIssued,
  fromBanquetRequestCreated,
  fromBanquetStatusChanged,
  fromCertificateIssued,
  fromOrderCancelled,
  fromOrderCompleted,
  fromOrderPlaced,
  fromOrderRefund,
  fromReservationCreated,
  fromReservationStatusChanged,
  periodTotals,
} from './history';

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });
const customer = { customerId: null, phone: '+77011234567', name: 'Асель' };

const placed: OrderPlacedPayload = {
  orderId: 'o-1',
  number: 'GL-2026-000001',
  branchId: 'b-1',
  type: 'delivery',
  channel: 'web',
  status: 'paid',
  customer,
  items: [],
  subtotal: kzt(500_000),
  discount: kzt(0),
  deliveryFee: kzt(50_000),
  total: kzt(550_000),
  paymentMethod: 'online',
  promoCode: null,
  scheduledFor: null,
  analyticsSessionId: null,
  locale: 'kk',
  publicToken: 't',
  occurredAt: '2026-10-01T06:00:00.000Z',
};

describe('history: orders', () => {
  it('order placed -> activity, orders counter, locale for a new guest', () => {
    const { ref, draft } = fromOrderPlaced(placed);
    expect(ref).toEqual({ customerId: null, phone: '+77011234567', name: 'Асель', email: null, locale: 'kk' });
    expect(draft).toMatchObject({
      type: ActivityType.OrderPlaced,
      entityType: 'order',
      entityId: 'o-1',
      branchId: 'b-1',
      amount: kzt(550_000),
      countsAsSpent: false,
      delta: { ordersCount: 1 },
    });
    expect(draft.summary).toContain('GL-2026-000001');
    expect(draft.occurredAt.toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });

  it('order completed counts as spent', () => {
    const completed: OrderCompletedPayload = {
      orderId: 'o-1',
      number: 'GL-2026-000001',
      branchId: 'b-1',
      type: 'pickup',
      channel: 'admin',
      customer: { ...customer, customerId: 'c-1' },
      items: [],
      subtotal: kzt(550_000),
      discount: kzt(0),
      deliveryFee: kzt(0),
      total: kzt(550_000),
      placedAt: '2026-10-01T06:00:00.000Z',
      completedAt: '2026-10-01T07:00:00.000Z',
    };
    const { ref, draft } = fromOrderCompleted(completed);
    expect(ref.customerId).toBe('c-1');
    expect(draft).toMatchObject({ type: 'order_completed', countsAsSpent: true, delta: { completedOrdersCount: 1, spent: 550_000 } });
    expect(draft.occurredAt.toISOString()).toBe('2026-10-01T07:00:00.000Z');
  });

  it('order cancelled is history only', () => {
    const cancelled: OrderCancelledPayload = {
      orderId: 'o-1',
      number: 'GL-2026-000001',
      branchId: 'b-1',
      type: 'delivery',
      channel: 'web',
      customer,
      total: kzt(550_000),
      reasonCode: 'guest_request',
      reason: null,
      wasPaid: false,
      cancelledAt: '2026-10-01T06:10:00.000Z',
    };
    expect(fromOrderCancelled(cancelled).draft).toMatchObject({ type: 'order_cancelled', countsAsSpent: false, delta: {} });
  });

  it('refund of an order reduces spent (negative amount); other purposes are ignored', () => {
    const refund: RefundEventPayload = {
      refundId: 'rf-1',
      paymentId: 'p-1',
      purpose: 'order',
      referenceId: 'o-1',
      branchId: 'b-1',
      amount: kzt(50_000),
      paymentFullyRefunded: false,
      referenceFullyRefunded: false,
      reason: 'недовложение',
      occurredAt: '2026-10-02T06:00:00.000Z',
    };
    expect(fromOrderRefund(refund)?.draft).toMatchObject({
      type: 'order_refunded',
      entityType: 'order',
      entityId: 'o-1',
      amount: kzt(-50_000),
      countsAsSpent: true,
      delta: { spent: -50_000 },
    });
    expect(fromOrderRefund({ ...refund, purpose: 'reservation_deposit' })).toBeNull();
    expect(fromOrderRefund({ ...refund, amount: kzt(0) })).toBeNull();
    const a = applyDelta({ ...emptyAggregates(), totalSpent: Money.of(30_000) }, { spent: -50_000 });
    expect(a.totalSpent.amount).toBe(0);
  });

  it('rejects malformed event dates', () => {
    expect(() => fromOrderPlaced({ ...placed, occurredAt: 'yesterday' })).toThrow(/Invalid event date/);
  });
});

describe('history: reservations', () => {
  const created: ReservationCreatedPayload = {
    reservationId: 'r-1',
    number: 'GL-R-1',
    branchId: 'b-1',
    venueId: 'v-1',
    venueName: { ru: 'VIP' },
    venueTypeCode: 'vip',
    kind: 'regular',
    status: 'confirmed',
    start: '2026-10-02T14:00:00.000Z',
    end: '2026-10-02T16:00:00.000Z',
    guests: 4,
    customer,
    deposit: kzt(5_000_000),
    banquetRequestId: null,
    source: 'web',
    locale: 'ru',
    publicToken: null,
    occurredAt: '2026-10-01T06:00:00.000Z',
  };
  const changed = (from: string, to: string): ReservationStatusChangedPayload => ({
    reservationId: 'r-1',
    number: 'GL-R-1',
    branchId: 'b-1',
    venueId: 'v-1',
    venueTypeCode: 'vip',
    kind: 'regular',
    from: from as never,
    to: to as never,
    start: created.start,
    end: created.end,
    guests: 4,
    customer,
    deposit: kzt(5_000_000),
    depositOutcome: 'retained',
    reason: null,
    locale: 'ru',
    publicToken: null,
    occurredAt: '2026-10-02T17:00:00.000Z',
  });

  it('regular reservation increments reservations; banquet holds are skipped', () => {
    expect(fromReservationCreated(created)?.draft).toMatchObject({ type: 'reservation_created', delta: { reservationsCount: 1 }, amount: kzt(5_000_000) });
    expect(fromReservationCreated({ ...created, kind: 'banquet' })).toBeNull();
  });

  it('no-show counter grows on no_show and is corrected back', () => {
    expect(fromReservationStatusChanged(changed('confirmed', 'no_show'))?.draft).toMatchObject({
      type: 'reservation_no_show',
      delta: { noShowCount: 1 },
    });
    expect(fromReservationStatusChanged(changed('no_show', 'arrived'))?.draft).toMatchObject({
      type: 'reservation_arrived',
      delta: { noShowCount: -1 },
    });
    expect(fromReservationStatusChanged(changed('no_show', 'confirmed'))?.draft).toMatchObject({
      type: 'reservation_status_changed',
      delta: { noShowCount: -1 },
    });
    expect(fromReservationStatusChanged(changed('confirmed', 'arrived'))?.draft).toMatchObject({ type: 'reservation_arrived', delta: {} });
    expect(fromReservationStatusChanged(changed('pending', 'confirmed'))).toBeNull();
    expect(fromReservationStatusChanged({ ...changed('confirmed', 'no_show'), kind: 'banquet' })).toBeNull();
  });
});

describe('history: banquets and certificates', () => {
  const contact = { customerId: null, name: 'ТОО Ромашка, Ерлан', phone: '+77019998877', email: 'erlan@romashka.kz' };

  it('banquet request -> banquet tag and counter', () => {
    const p: BanquetRequestCreatedPayload = {
      requestId: 'q-1',
      number: 'BQ-2026-000001',
      branchId: null,
      isOffsite: true,
      eventDate: '2026-12-20',
      eventType: 'корпоратив',
      guests: 60,
      budget: kzt(150_000_000),
      managerId: 'm-1',
      contact,
      source: 'web',
      occurredAt: '2026-10-01T06:00:00.000Z',
    };
    const { ref, draft } = fromBanquetRequestCreated(p);
    expect(ref.email).toBe('erlan@romashka.kz');
    expect(draft).toMatchObject({ type: 'banquet_requested', delta: { banquetsCount: 1 }, tags: ['banquet'], amount: kzt(150_000_000) });
  });

  it('banquet held counts the quote total as spent', () => {
    const base: BanquetStatusChangedPayload = {
      requestId: 'q-1',
      number: 'BQ-2026-000001',
      branchId: 'b-1',
      isOffsite: false,
      from: 'prepaid',
      to: 'held',
      managerId: 'm-1',
      eventDate: '2026-12-20',
      guests: 60,
      quoteTotal: kzt(120_000_000),
      contact,
      reason: null,
      occurredAt: '2026-12-21T06:00:00.000Z',
    };
    expect(fromBanquetStatusChanged(base).draft).toMatchObject({ type: 'banquet_held', countsAsSpent: true, delta: { spent: 120_000_000 } });
    expect(fromBanquetStatusChanged({ ...base, to: 'cancelled', from: 'new' }).draft).toMatchObject({
      type: 'banquet_cancelled',
      countsAsSpent: false,
      delta: {},
    });
    expect(fromBanquetStatusChanged({ ...base, to: 'in_progress', from: 'new', quoteTotal: null }).draft).toMatchObject({
      type: 'banquet_status_changed',
      amount: null,
    });
  });

  it('invoice to a company -> corporate tag', () => {
    const invoice: BanquetInvoiceIssuedPayload = {
      invoiceId: 'i-1',
      number: 'GL-2026-000010',
      requestId: 'q-1',
      branchId: 'b-1',
      payerType: 'company',
      company: { name: 'ТОО Ромашка', bin: '123456789012' },
      amount: kzt(60_000_000),
      dueDate: '2026-10-10',
      occurredAt: '2026-10-01T06:00:00.000Z',
    };
    expect(fromBanquetInvoiceIssued(invoice).draft).toMatchObject({ type: 'banquet_invoice_issued', tags: ['corporate'], countsAsSpent: false });
    expect(fromBanquetInvoiceIssued({ ...invoice, payerType: 'individual', company: null }).draft.tags).toEqual([]);
  });

  it('certificate purchase by buyer phone counts as spent', () => {
    const cert: CertificateIssuedPayload = {
      certificateId: 'g-1',
      productId: 'p-1',
      kind: 'amount',
      nominal: kzt(2_000_000),
      price: kzt(2_000_000),
      buyerPhone: '+77011234567',
      branchId: null,
      occurredAt: '2026-10-01T06:00:00.000Z',
    };
    expect(fromCertificateIssued(cert)?.draft).toMatchObject({ type: 'certificate_purchased', countsAsSpent: true, delta: { spent: 2_000_000 } });
    expect(fromCertificateIssued({ ...cert, buyerPhone: null })).toBeNull();
  });
});

describe('history: aggregates, auto tags and period totals', () => {
  it('applies deltas without going negative', () => {
    let a = emptyAggregates();
    a = applyDelta(a, { ordersCount: 1, completedOrdersCount: 1, spent: 100_00 });
    a = applyDelta(a, { noShowCount: -1 });
    expect(a).toMatchObject({ ordersCount: 1, completedOrdersCount: 1, noShowCount: 0 });
    expect(a.totalSpent.equals(Money.of(100_00))).toBe(true);
  });

  it('regular from 3 completed orders; banquet after a request', () => {
    const two = { ...emptyAggregates(), completedOrdersCount: 2 };
    expect(autoTags(two)).toEqual([]);
    expect(autoTags({ ...two, completedOrdersCount: 3 })).toEqual(['regular']);
    expect(autoTags({ ...two, banquetsCount: 1 })).toEqual(['banquet']);
  });

  it('sums a period from activity stats', () => {
    const totals = periodTotals([
      { type: 'order_completed', count: 2, spentAmount: 1_100_000 },
      { type: 'order_placed', count: 3, spentAmount: 0 },
      { type: 'certificate_purchased', count: 1, spentAmount: 2_000_000 },
      { type: 'reservation_no_show', count: 1, spentAmount: 0 },
      { type: 'order_refunded', count: 1, spentAmount: -100_000 },
    ]);
    expect(totals.spent.toJSON()).toEqual(kzt(3_000_000));
    expect(totals).toMatchObject({ ordersPlaced: 3, ordersCompleted: 2, ordersRefunded: 1, certificatesPurchased: 1, noShows: 1, activities: 8 });
  });
});
