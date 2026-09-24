import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import {
  addChannelAmount,
  banquetSale,
  certificateSale,
  emptyChannelAmounts,
  isNewerStatus,
  ORDER_STATUS_RANK,
  orderSale,
  orderSalesChannel,
  refundRevenueFact,
} from './revenue';

const completedAt = zonedTimeToUtc('2026-10-01', '23:30');

describe('revenue recognition', () => {
  it('order revenue at completion on the local date, channel by order type', () => {
    const fact = orderSale({ orderId: 'o1', type: 'pickup', channel: 'web', branchId: 'b1', total: Money.of(500_000), completedAt });
    expect(fact).toMatchObject({ kind: 'sale', channel: 'pickup', localDate: '2026-10-01', orderChannel: 'web', branchId: 'b1' });
    expect(fact.amount.amount).toBe(500_000);
    expect(orderSalesChannel('delivery')).toBe('delivery');
  });

  it('banquet revenue at held (quote total), certificate at sale (price)', () => {
    expect(banquetSale({ requestId: 'r1', branchId: null, total: Money.of(10_000_000), heldAt: completedAt })).toMatchObject({
      channel: 'banquet',
      localDate: '2026-10-01',
    });
    expect(banquetSale({ requestId: 'r1', branchId: null, total: null, heldAt: completedAt }).amount.isZero()).toBe(true);
    const cert = certificateSale({ certificateId: 'c1', branchId: null, price: Money.of(2_000_000), issuedAt: completedAt });
    expect(cert).toMatchObject({ channel: 'certificate', sourceType: 'certificate' });
  });

  describe('refunds', () => {
    const base = { refundId: 'rf1', referenceId: 'o1', branchId: 'b1', amount: Money.of(100_000) };

    it('refund of a completed order reduces revenue on the refund day', () => {
      const refundedAt = zonedTimeToUtc('2026-10-03', '10:00');
      const fact = refundRevenueFact(
        { ...base, purpose: 'order', refundedAt },
        { order: { orderId: 'o1', type: 'delivery', channel: 'web', branchId: 'b1', completedAt } },
      );
      expect(fact).toMatchObject({ kind: 'refund', channel: 'delivery', localDate: '2026-10-03', referenceId: 'o1' });
      expect(fact!.amount.amount).toBe(-100_000);
    });

    it('refund of a cancelled (never completed) order does not touch revenue', () => {
      const refundedAt = zonedTimeToUtc('2026-10-03', '10:00');
      expect(
        refundRevenueFact(
          { ...base, purpose: 'order', refundedAt },
          { order: { orderId: 'o1', type: 'delivery', channel: 'web', branchId: 'b1', completedAt: null } },
        ),
      ).toBeNull();
      expect(refundRevenueFact({ ...base, purpose: 'order', refundedAt }, { order: null })).toBeNull();
    });

    it('refund before completion is not a revenue refund', () => {
      expect(
        refundRevenueFact(
          { ...base, purpose: 'order', refundedAt: new Date(completedAt.getTime() - 60_000) },
          { order: { orderId: 'o1', type: 'delivery', channel: 'web', branchId: 'b1', completedAt } },
        ),
      ).toBeNull();
    });

    it('banquet refund only after held; deposit refunds are never revenue', () => {
      const refundedAt = zonedTimeToUtc('2026-10-05', '12:00');
      expect(
        refundRevenueFact({ ...base, purpose: 'banquet_invoice', refundedAt }, { banquet: { requestId: 'r1', branchId: 'b2', heldAt: completedAt } }),
      ).toMatchObject({ channel: 'banquet', branchId: 'b2', referenceId: 'r1' });
      expect(
        refundRevenueFact({ ...base, purpose: 'banquet_invoice', refundedAt }, { banquet: { requestId: 'r1', branchId: 'b2', heldAt: null } }),
      ).toBeNull();
      expect(refundRevenueFact({ ...base, purpose: 'reservation_deposit', refundedAt }, {})).toBeNull();
    });

    it('certificate purchase refund reduces certificate revenue', () => {
      const fact = refundRevenueFact({ ...base, branchId: null, purpose: 'gift_certificate', refundedAt: completedAt }, {});
      expect(fact).toMatchObject({ channel: 'certificate', branchId: null });
    });
  });
});

describe('status ordering for out-of-order events', () => {
  const t1 = new Date('2026-10-01T10:00:00Z');
  const t2 = new Date('2026-10-01T10:05:00Z');

  it('newer timestamp wins, equal timestamps resolved by rank', () => {
    expect(isNewerStatus(null, { at: t1, rank: 0 })).toBe(true);
    expect(isNewerStatus({ at: t2, rank: ORDER_STATUS_RANK.ready! }, { at: t1, rank: ORDER_STATUS_RANK.completed! })).toBe(false);
    expect(isNewerStatus({ at: t1, rank: ORDER_STATUS_RANK.accepted! }, { at: t1, rank: ORDER_STATUS_RANK.cancelled! })).toBe(true);
    expect(isNewerStatus({ at: t1, rank: ORDER_STATUS_RANK.cancelled! }, { at: t1, rank: ORDER_STATUS_RANK.accepted! })).toBe(false);
  });
});

describe('channel amounts', () => {
  it('accumulates net revenue per channel with refunds shown separately', () => {
    let acc = emptyChannelAmounts();
    acc = addChannelAmount(acc, 'delivery', Money.of(1000), Money.of(-200));
    acc = addChannelAmount(acc, 'certificate', Money.of(500), Money.zero());
    expect(acc.delivery.amount).toBe(800);
    expect(acc.certificate.amount).toBe(500);
    expect(acc.refunds.amount).toBe(-200);
    expect(acc.total.amount).toBe(1300);
  });
});
