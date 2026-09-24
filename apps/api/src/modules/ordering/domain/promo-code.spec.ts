import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import {
  evaluatePromo,
  normalizePromoCode,
  PromoCodeDefinition,
  PromoCodeState,
  PromoContext,
  promoRejectionError,
  validatePromoDefinition,
} from './promo-code';

const NOW = new Date('2026-10-01T08:00:00.000Z');

function promo(overrides: Partial<PromoCodeState> = {}): PromoCodeState {
  return {
    id: 'p1',
    code: 'WELCOME10',
    description: null,
    kind: 'percent',
    percentBp: 1000,
    fixedAmount: null,
    minSubtotal: null,
    validFrom: null,
    validTo: null,
    totalLimit: null,
    perPhoneLimit: null,
    branchId: null,
    isActive: true,
    ...overrides,
  };
}

function ctx(overrides: Partial<PromoContext> = {}): PromoContext {
  return { now: NOW, branchId: 'b1', type: 'delivery', subtotal: Money.tenge(5000), usage: { total: 0, byPhone: 0 }, ...overrides };
}

describe('promo code rules', () => {
  it('percent discount in basis points, half-up rounding', () => {
    const r = evaluatePromo(promo({ percentBp: 1000 }), ctx({ subtotal: Money.of(123_455) }));
    expect(r).toEqual({ ok: true, effect: { discount: Money.of(12_346), freeDelivery: false } });
  });

  it('fixed discount is capped by the subtotal', () => {
    const r = evaluatePromo(promo({ kind: 'fixed', percentBp: null, fixedAmount: Money.tenge(10000) }), ctx({ subtotal: Money.tenge(4000) }));
    expect(r.ok && r.effect.discount.amount).toBe(400_000);
  });

  it('free delivery applies to delivery only', () => {
    const fd = promo({ kind: 'free_delivery', percentBp: null });
    expect(evaluatePromo(fd, ctx())).toEqual({ ok: true, effect: { discount: Money.zero(), freeDelivery: true } });
    expect(evaluatePromo(fd, ctx({ type: 'pickup' }))).toMatchObject({ ok: false, reason: 'not_applicable' });
  });

  it('checks activity and validity period', () => {
    expect(evaluatePromo(promo({ isActive: false }), ctx())).toMatchObject({ ok: false, reason: 'inactive' });
    expect(evaluatePromo(promo({ validFrom: new Date('2026-10-02T00:00:00Z') }), ctx())).toMatchObject({ ok: false, reason: 'not_started' });
    expect(evaluatePromo(promo({ validTo: NOW }), ctx())).toMatchObject({ ok: false, reason: 'expired' });
    expect(evaluatePromo(promo({ validFrom: new Date('2026-09-01'), validTo: new Date('2026-12-01') }), ctx()).ok).toBe(true);
  });

  it('branch restriction', () => {
    expect(evaluatePromo(promo({ branchId: 'b2' }), ctx())).toMatchObject({ ok: false, reason: 'wrong_branch' });
    expect(evaluatePromo(promo({ branchId: 'b1' }), ctx()).ok).toBe(true);
  });

  it('minimal subtotal', () => {
    expect(evaluatePromo(promo({ minSubtotal: Money.tenge(6000) }), ctx())).toMatchObject({ ok: false, reason: 'min_subtotal' });
    expect(evaluatePromo(promo({ minSubtotal: Money.tenge(5000) }), ctx()).ok).toBe(true);
  });

  it('total and per-phone limits', () => {
    expect(evaluatePromo(promo({ totalLimit: 3 }), ctx({ usage: { total: 3, byPhone: 0 } }))).toMatchObject({ reason: 'total_limit_reached' });
    expect(evaluatePromo(promo({ totalLimit: 3 }), ctx({ usage: { total: 2, byPhone: 0 } })).ok).toBe(true);
    expect(evaluatePromo(promo({ perPhoneLimit: 1 }), ctx({ usage: { total: 5, byPhone: 1 } }))).toMatchObject({ reason: 'phone_limit_reached' });
    // Телефон неизвестен (расчёт корзины) — лимит на телефон не проверяется.
    expect(evaluatePromo(promo({ perPhoneLimit: 1 }), ctx({ usage: { total: 5, byPhone: null } })).ok).toBe(true);
  });

  it('rejection error carries a machine code promo.<reason>', () => {
    const r = evaluatePromo(promo({ isActive: false }), ctx());
    if (r.ok) throw new Error('expected rejection');
    const err = promoRejectionError('WELCOME10', r);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.code).toBe('promo.inactive');
  });
});

describe('promo definition', () => {
  const base: PromoCodeDefinition = {
    code: ' welcome10 ',
    description: '  Скидка новичкам ',
    kind: 'percent',
    percentBp: 1000,
    fixedAmount: null,
    minSubtotal: Money.zero(),
    validFrom: null,
    validTo: null,
    totalLimit: null,
    perPhoneLimit: 1,
    branchId: null,
    isActive: true,
  };

  it('normalizes the code and description', () => {
    const def = validatePromoDefinition(base);
    expect(def.code).toBe('WELCOME10');
    expect(def.description).toBe('Скидка новичкам');
    expect(def.minSubtotal).toBeNull();
    expect(normalizePromoCode(' ab c ')).toBe('ABC');
  });

  it('validates kind-specific fields, limits and period', () => {
    expect(() => validatePromoDefinition({ ...base, code: 'a' })).toThrow(expect.objectContaining({ code: 'promo.invalid_code_format' }));
    expect(() => validatePromoDefinition({ ...base, percentBp: 0 })).toThrow(expect.objectContaining({ code: 'promo.invalid_percent' }));
    expect(() => validatePromoDefinition({ ...base, percentBp: 10_001 })).toThrow(expect.objectContaining({ code: 'promo.invalid_percent' }));
    expect(() => validatePromoDefinition({ ...base, kind: 'fixed', fixedAmount: Money.zero() })).toThrow(
      expect.objectContaining({ code: 'promo.invalid_fixed_amount' }),
    );
    expect(() => validatePromoDefinition({ ...base, totalLimit: 0 })).toThrow(expect.objectContaining({ code: 'promo.invalid_limit' }));
    expect(() =>
      validatePromoDefinition({ ...base, validFrom: new Date('2026-10-02'), validTo: new Date('2026-10-01') }),
    ).toThrow(expect.objectContaining({ code: 'promo.invalid_period' }));
    const fixed = validatePromoDefinition({ ...base, kind: 'fixed', percentBp: 500, fixedAmount: Money.tenge(500) });
    expect(fixed.percentBp).toBeNull();
    expect(fixed.fixedAmount?.amount).toBe(50_000);
    const fd = validatePromoDefinition({ ...base, kind: 'free_delivery' });
    expect(fd.percentBp).toBeNull();
  });
});
