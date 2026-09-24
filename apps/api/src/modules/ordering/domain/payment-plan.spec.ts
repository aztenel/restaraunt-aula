import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { allocateRefund, confirmedAmount, isFullyPaid, OrderPaymentPosition, planCheckoutPayments, refundableAmount, totalRefundable } from './payment-plan';

function pos(overrides: Partial<OrderPaymentPosition>): OrderPaymentPosition {
  return {
    paymentId: 'p',
    method: 'online',
    status: 'succeeded',
    amount: Money.tenge(1000),
    refunded: Money.zero(),
    pendingRefunds: Money.zero(),
    ...overrides,
  };
}

describe('checkout payment plan', () => {
  it('certificate covers min(balance, total), the rest is the remainder', () => {
    expect(planCheckoutPayments(Money.tenge(5000), Money.tenge(2000))).toEqual({ certificate: Money.tenge(2000), remainder: Money.tenge(3000) });
    expect(planCheckoutPayments(Money.tenge(5000), Money.tenge(9000))).toEqual({ certificate: Money.tenge(5000), remainder: Money.zero() });
    expect(planCheckoutPayments(Money.tenge(5000), null)).toEqual({ certificate: Money.zero(), remainder: Money.tenge(5000) });
    expect(planCheckoutPayments(Money.tenge(5000), Money.zero()).certificate.amount).toBe(0);
  });
});

describe('payment confirmation', () => {
  it('counts captured online and certificate payments, not on_receipt', () => {
    const payments = [
      pos({ paymentId: 'c', method: 'gift_certificate', amount: Money.tenge(2000) }),
      pos({ paymentId: 'o', method: 'online', amount: Money.tenge(3000) }),
      pos({ paymentId: 'r', method: 'on_receipt', amount: Money.tenge(3000) }),
      pos({ paymentId: 'f', method: 'online', status: 'failed', amount: Money.tenge(3000) }),
    ];
    expect(confirmedAmount(payments).amount).toBe(500_000);
    expect(isFullyPaid(payments, Money.tenge(5000))).toBe(true);
    expect(isFullyPaid(payments.slice(0, 1), Money.tenge(5000))).toBe(false);
    expect(isFullyPaid([], Money.zero())).toBe(true);
  });
});

describe('refund allocation', () => {
  const payments = [
    pos({ paymentId: 'cert', method: 'gift_certificate', amount: Money.tenge(2000) }),
    pos({ paymentId: 'card', method: 'online', amount: Money.tenge(3000), refunded: Money.tenge(500) }),
    pos({ paymentId: 'cash', method: 'on_receipt', status: 'pending', amount: Money.tenge(1000) }),
  ];

  it('refundable excludes not captured payments, completed and pending refunds', () => {
    expect(refundableAmount(payments[1]!).amount).toBe(250_000);
    expect(refundableAmount(payments[2]!).amount).toBe(0);
    expect(refundableAmount(pos({ pendingRefunds: Money.tenge(400) })).amount).toBe(60_000);
    expect(totalRefundable(payments).amount).toBe(450_000);
  });

  it('full refund returns every refundable remainder', () => {
    expect(allocateRefund(null, payments)).toEqual([
      { paymentId: 'card', method: 'online', amount: Money.tenge(2500) },
      { paymentId: 'cert', method: 'gift_certificate', amount: Money.tenge(2000) },
    ]);
  });

  it('partial refund goes to money first, certificate last', () => {
    expect(allocateRefund(Money.tenge(3000), payments)).toEqual([
      { paymentId: 'card', method: 'online', amount: Money.tenge(2500) },
      { paymentId: 'cert', method: 'gift_certificate', amount: Money.tenge(500) },
    ]);
    expect(allocateRefund(Money.tenge(100), payments)).toEqual([{ paymentId: 'card', method: 'online', amount: Money.tenge(100) }]);
    expect(allocateRefund(Money.zero(), payments)).toEqual([]);
  });

  it('cannot refund more than was paid', () => {
    expect(() => allocateRefund(Money.tenge(4501), payments)).toThrow(expect.objectContaining({ code: 'order.refund_exceeds_paid' }));
    expect(() => allocateRefund(Money.of(-1), payments)).toThrow(expect.objectContaining({ code: 'order.refund_invalid_amount' }));
  });
});
