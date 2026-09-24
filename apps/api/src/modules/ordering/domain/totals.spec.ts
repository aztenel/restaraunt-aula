import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { computeOrderTotals, ZoneTerms } from './totals';

const zone: ZoneTerms = {
  zoneId: 'z',
  minOrderAmount: Money.tenge(3000),
  deliveryFee: Money.tenge(500),
  freeDeliveryFrom: Money.tenge(10000),
  etaMinutes: 45,
};

describe('computeOrderTotals', () => {
  it('sums lines and adds zone delivery fee', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(2000), Money.tenge(1500)], type: 'delivery', zone, promo: null });
    expect(t.subtotal.amount).toBe(350_000);
    expect(t.deliveryFee.amount).toBe(50_000);
    expect(t.total.amount).toBe(400_000);
    expect(t.minOrderShortfall.amount).toBe(0);
    expect(t.amountToFreeDelivery?.amount).toBe(650_000);
  });

  it('pickup has no delivery fee and no zone minimum', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(100)], type: 'pickup', zone, promo: null });
    expect(t.deliveryFee.amount).toBe(0);
    expect(t.minOrderShortfall.amount).toBe(0);
    expect(t.total.amount).toBe(10_000);
  });

  it('free delivery from the zone threshold (compared with the dish subtotal before discount)', () => {
    const t = computeOrderTotals({
      lineTotals: [Money.tenge(10000)],
      type: 'delivery',
      zone,
      promo: { discount: Money.tenge(1000), freeDelivery: false },
    });
    expect(t.deliveryFee.amount).toBe(0);
    expect(t.freeDeliveryReason).toBe('threshold');
    expect(t.baseDeliveryFee.amount).toBe(50_000);
    expect(t.total.amount).toBe(900_000);
  });

  it('free delivery promo removes only the delivery fee', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(4000)], type: 'delivery', zone, promo: { discount: Money.zero(), freeDelivery: true } });
    expect(t.deliveryFee.amount).toBe(0);
    expect(t.discount.amount).toBe(0);
    expect(t.freeDeliveryReason).toBe('promo');
    expect(t.total.amount).toBe(400_000);
  });

  it('discount never exceeds the subtotal and never touches the delivery fee', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(3000)], type: 'delivery', zone, promo: { discount: Money.tenge(99999), freeDelivery: false } });
    expect(t.discount.amount).toBe(300_000);
    expect(t.total.amount).toBe(50_000);
  });

  it('reports shortfall to the zone minimum', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(2500)], type: 'delivery', zone, promo: null });
    expect(t.minOrderShortfall.amount).toBe(50_000);
  });

  it('delivery without a zone (quote before the address is known) has no fee', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(2500)], type: 'delivery', zone: null, promo: null });
    expect(t.deliveryFee.amount).toBe(0);
    expect(t.total.amount).toBe(250_000);
  });

  it('zone without free threshold keeps the fee', () => {
    const t = computeOrderTotals({ lineTotals: [Money.tenge(50000)], type: 'delivery', zone: { ...zone, freeDeliveryFrom: null }, promo: null });
    expect(t.deliveryFee.amount).toBe(50_000);
    expect(t.amountToFreeDelivery).toBeNull();
  });
});
