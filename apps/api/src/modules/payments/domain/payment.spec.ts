import { describe, expect, it } from 'vitest';
import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { isReferenceFullyRefunded, NewPaymentInput, Payment, PaymentFsm } from './payment';

const now = new Date('2026-10-01T10:00:00Z');

function input(overrides: Partial<NewPaymentInput> = {}): NewPaymentInput {
  return {
    id: 'p1',
    purpose: 'order',
    referenceId: 'o1',
    branchId: 'b1',
    method: 'online',
    provider: 'sandbox',
    amount: Money.tenge(5000),
    description: 'Заказ GL-2026-000001',
    customer: { phone: '+77771234567', name: 'Гость', email: null },
    returnUrl: null,
    idempotencyKey: 'k1',
    ...overrides,
  };
}

describe('Payment', () => {
  it('starts in status by method', () => {
    expect(Payment.create(input(), now).status).toBe('created');
    expect(Payment.create(input({ method: 'on_receipt', provider: 'on_receipt' }), now).status).toBe('pending');
    const cert = Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate', certificateId: 'c1' }), now);
    expect(cert.status).toBe('succeeded');
    expect(cert.toView().paidAt).toEqual(now);
    const paidAt = new Date('2026-09-30T05:00:00Z');
    const bank = Payment.create(input({ method: 'bank_transfer', provider: 'bank_transfer', documentNumber: '15', paidAt }), now);
    expect(bank.status).toBe('succeeded');
    expect(bank.toView().paidAt).toEqual(paidAt);
  });

  it('validates input', () => {
    expect(() => Payment.create(input({ amount: Money.zero() }), now)).toThrow(ValidationError);
    expect(() => Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate' }), now)).toThrow(ValidationError);
    expect(() => Payment.create(input({ method: 'bank_transfer', provider: 'bank_transfer' }), now)).toThrow(ValidationError);
    expect(() => Payment.create(input({ expiresAt: new Date(now.getTime() - 1) }), now)).toThrow(ValidationError);
    expect(() => Payment.create(input({ idempotencyKey: ' ' }), now)).toThrow(ValidationError);
  });

  it('moves created -> pending -> succeeded and ignores repeated confirmation', () => {
    const p = Payment.create(input({ expiresAt: new Date(now.getTime() + 3600_000) }), now);
    p.markInitiated({ externalId: 'ext-1', paymentUrl: 'https://pay', expiresAt: new Date(now.getTime() + 600_000) });
    expect(p.status).toBe('pending');
    // Срок — меньший из заданного и срока страницы провайдера.
    expect(p.expiresAt).toEqual(new Date(now.getTime() + 600_000));
    expect(p.confirmPaid(now, Money.tenge(5000))).toBe('applied');
    expect(p.status).toBe('succeeded');
    expect(p.confirmPaid(now, Money.tenge(5000))).toBe('ignored');
  });

  it('does not mark paid on amount mismatch', () => {
    const p = Payment.create(input(), now);
    p.markInitiated({ externalId: 'ext-1', paymentUrl: 'https://pay', expiresAt: null });
    expect(p.confirmPaid(now, Money.tenge(4999))).toBe('amount_mismatch');
    expect(p.status).toBe('pending');
    expect(p.confirmPaid(now, null)).toBe('applied');
  });

  it('accepts a late provider confirmation after cancel or failure', () => {
    const cancelled = Payment.create(input(), now);
    cancelled.markInitiated({ externalId: 'ext-1', paymentUrl: 'https://pay', expiresAt: null });
    expect(cancelled.cancel('expired', now)).toBe('applied');
    expect(cancelled.cancel('again', now)).toBe('ignored');
    expect(cancelled.confirmPaid(now, Money.tenge(5000))).toBe('applied');
    expect(cancelled.status).toBe('succeeded');

    const failed = Payment.create(input(), now);
    expect(failed.fail('gateway down', now)).toBe('applied');
    expect(failed.confirmPaid(now, null)).toBe('applied');
  });

  it('forbids transitions outside the scheme', () => {
    expect(PaymentFsm.canTransition('created', 'succeeded')).toBe(false);
    expect(PaymentFsm.canTransition('refunded', 'succeeded')).toBe(false);
    const p = Payment.create(input(), now);
    // created -> succeeded недопустим: подтверждение игнорируется.
    expect(p.confirmPaid(now, null)).toBe('ignored');
    p.markInitiated({ externalId: 'x', paymentUrl: 'u', expiresAt: null });
    expect(() => p.markInitiated({ externalId: 'x', paymentUrl: 'u', expiresAt: null })).toThrow(InvalidStateTransitionError);
    const paid = Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate', certificateId: 'c' }), now);
    expect(paid.cancel('x', now)).toBe('ignored');
    expect(paid.fail('x', now)).toBe('ignored');
  });

  it('collects on_receipt payments only', () => {
    const p = Payment.create(input({ method: 'on_receipt', provider: 'on_receipt' }), now);
    expect(p.collect(now)).toBe('applied');
    expect(p.collect(now)).toBe('ignored');
    expect(() => Payment.create(input(), now).collect(now)).toThrow(ConflictError);
  });

  it('plans refunds within the refundable remainder', () => {
    const p = Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate', certificateId: 'c' }), now);
    expect(p.planRefund(undefined, Money.zero()).amount).toBe(500_000);
    expect(p.planRefund(Money.tenge(100), Money.tenge(4000)).amount).toBe(10_000);
    expect(() => p.planRefund(Money.tenge(1001), Money.tenge(4000))).toThrow(ConflictError);
    expect(() => p.planRefund(undefined, Money.tenge(5000))).toThrow(ConflictError);
    expect(() => p.planRefund(Money.zero(), Money.zero())).toThrow(ValidationError);
    const unpaid = Payment.create(input(), now);
    expect(() => unpaid.planRefund(undefined, Money.zero())).toThrow(ConflictError);
  });

  it('applies refunds: succeeded -> partially_refunded -> refunded, never above amount', () => {
    const p = Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate', certificateId: 'c' }), now);
    p.applyRefund(Money.tenge(1000));
    expect(p.status).toBe('partially_refunded');
    p.applyRefund(Money.tenge(1000));
    expect(p.status).toBe('partially_refunded');
    expect(() => p.applyRefund(Money.tenge(3001))).toThrow(ConflictError);
    p.applyRefund(Money.tenge(3000));
    expect(p.status).toBe('refunded');
    expect(p.refunded.amount).toBe(500_000);
    expect(p.isFullyRefunded()).toBe(true);
  });

  it('full refund goes succeeded -> refunded directly', () => {
    const p = Payment.create(input({ method: 'gift_certificate', provider: 'gift_certificate', certificateId: 'c' }), now);
    p.applyRefund(Money.tenge(5000));
    expect(p.status).toBe('refunded');
  });

  it('detects fully refunded reference ignoring unpaid payments', () => {
    expect(isReferenceFullyRefunded([{ status: 'refunded' }, { status: 'cancelled' }])).toBe(true);
    expect(isReferenceFullyRefunded([{ status: 'refunded' }, { status: 'partially_refunded' }])).toBe(false);
    expect(isReferenceFullyRefunded([{ status: 'failed' }])).toBe(false);
  });
});
