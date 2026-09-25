import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { assertWithinQuote, BanquetInvoice, defaultDueDate, defaultInvoiceAmount } from './invoice';

const t = (n: number) => Money.tenge(n);
const now = new Date('2026-10-01T06:00:00Z');

function invoice(amount = 100_000) {
  return new BanquetInvoice({
    id: 'i1',
    amount: t(amount),
    paid: Money.zero(),
    refunded: Money.zero(),
    status: 'issued',
    dueDate: '2026-10-04',
    paidAt: null,
    cancelledAt: null,
  });
}

describe('BanquetInvoice', () => {
  it('records partial and full payments', () => {
    const inv = invoice();
    expect(inv.recordPayment(t(40_000), now)).toEqual({ fullyPaid: false });
    expect(inv.status).toBe('partially_paid');
    expect(inv.remaining().amount).toBe(6_000_000);
    expect(inv.recordPayment(t(60_000), now)).toEqual({ fullyPaid: true });
    expect(inv.status).toBe('paid');
    expect(inv.snapshot().paidAt).toEqual(now);
    expect(inv.remaining().isZero()).toBe(true);
  });

  it('never lets payments exceed the invoice amount', () => {
    const inv = invoice();
    inv.recordPayment(t(70_000), now);
    expect(inv.canAccept(t(30_001))).toBe(false);
    try {
      inv.recordPayment(t(30_001), now);
      throw new Error('expected overpayment error');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as ConflictError).code).toBe('banquet_invoice.overpayment');
      expect((err as ConflictError).details?.remaining).toEqual({ amount: 3_000_000, currency: 'KZT' });
    }
    expect(inv.snapshot().paid.amount).toBe(7_000_000);
    expect(() => inv.recordPayment(Money.zero(), now)).toThrow(ValidationError);
  });

  it('cancels only invoices without payments', () => {
    const paid = invoice();
    paid.recordPayment(t(1), now);
    expect(() => paid.cancel(now)).toThrow(ConflictError);
    const inv = invoice();
    inv.cancel(now);
    expect(inv.status).toBe('cancelled');
    expect(() => inv.cancel(now)).toThrow(InvalidStateTransitionError);
    expect(() => inv.assertCanAccept(t(1))).toThrow(/cancelled/);
  });

  it('is overdue after the due date while not fully paid', () => {
    const inv = invoice();
    expect(inv.isOverdue('2026-10-04')).toBe(false);
    expect(inv.isOverdue('2026-10-05')).toBe(true);
    inv.recordPayment(t(100_000), now);
    expect(inv.isOverdue('2026-10-05')).toBe(false);
  });

  it('tracks refunds without going above the paid amount', () => {
    const inv = invoice();
    inv.recordPayment(t(50_000), now);
    inv.recordRefund(t(20_000));
    expect(inv.netPaid().amount).toBe(3_000_000);
    inv.recordRefund(t(90_000));
    expect(inv.netPaid().amount).toBe(0);
  });
});

describe('invoice amounts and due dates', () => {
  it('defaults to the remaining prepayment until prepaid, then to the quote balance', () => {
    const ctx = { requestStatus: 'agreed', quoteTotal: t(1_000_000), requiredPrepayment: t(500_000), invoicedActive: Money.zero() };
    expect(defaultInvoiceAmount(ctx)).toEqual({ amount: t(500_000), purpose: 'prepayment' });
    expect(defaultInvoiceAmount({ ...ctx, invoicedActive: t(200_000) })).toEqual({ amount: t(300_000), purpose: 'prepayment' });
    expect(defaultInvoiceAmount({ ...ctx, invoicedActive: t(500_000) })).toEqual({ amount: t(500_000), purpose: 'payment' });
    expect(defaultInvoiceAmount({ ...ctx, requestStatus: 'prepaid', invoicedActive: t(500_000) })).toEqual({
      amount: t(500_000),
      purpose: 'payment',
    });
  });

  it('keeps all invoices within the quote total', () => {
    const ctx = { quoteTotal: t(1_000_000), invoicedActive: t(600_000) };
    expect(() => assertWithinQuote(t(400_000), ctx)).not.toThrow();
    expect(() => assertWithinQuote(t(400_001), ctx)).toThrow(/exceed the quote total/);
    expect(() => assertWithinQuote(Money.zero(), ctx)).toThrow(/positive/);
  });

  it('due date: 3 days for individuals, 5 for companies, not after the event', () => {
    expect(defaultDueDate('2026-10-01', '2026-12-01', 'individual')).toBe('2026-10-04');
    expect(defaultDueDate('2026-10-01', '2026-12-01', 'company')).toBe('2026-10-06');
    expect(defaultDueDate('2026-10-01', '2026-10-02', 'company')).toBe('2026-10-02');
    expect(defaultDueDate('2026-10-05', '2026-10-02', 'company')).toBe('2026-10-05');
  });
});
