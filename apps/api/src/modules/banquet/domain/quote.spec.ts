import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { calculateQuote, QuoteCalculationInput, QuoteLineInput } from './quote';

const t = (n: number) => Money.tenge(n);

function line(overrides: Partial<QuoteLineInput> = {}): QuoteLineInput {
  return {
    kind: 'menu',
    dishId: 'd1',
    title: { ru: 'Плов' },
    unit: 'порц.',
    quantity: 10,
    unitPrice: t(3_000),
    discount: null,
    ...overrides,
  };
}

function input(overrides: Partial<QuoteCalculationInput> = {}): QuoteCalculationInput {
  return { lines: [line()], discount: null, serviceChargeBp: 0, vat: { payer: false, rateBp: 0 }, guests: 10, ...overrides };
}

describe('calculateQuote', () => {
  it('sums lines, applies line and overall discounts, service charge, per-guest', () => {
    const q = calculateQuote(
      input({
        lines: [
          line({ quantity: 20, unitPrice: t(5_000), discount: { type: 'percent', bp: 1000 } }), // 100 000 - 10 000
          line({ kind: 'hall_rent', dishId: null, title: { ru: 'Аренда зала' }, unit: 'усл.', quantity: 1, unitPrice: t(150_000) }),
          line({ kind: 'musicians', dishId: null, title: { ru: 'Домбрист' }, unit: 'час', quantity: 3, unitPrice: t(20_000), discount: { type: 'amount', amount: t(5_000) } }),
        ],
        discount: { type: 'amount', amount: t(15_000) },
        serviceChargeBp: 1000,
        guests: 20,
      }),
    );
    expect(q.lines.map((l) => [l.position, l.gross.amount, l.discountAmount.amount, l.total.amount])).toEqual([
      [1, 10_000_000, 1_000_000, 9_000_000],
      [2, 15_000_000, 0, 15_000_000],
      [3, 6_000_000, 500_000, 5_500_000],
    ]);
    expect(q.lines[1]!.dishId).toBeNull();
    const totals = q.totals;
    expect(totals.subtotal.amount).toBe(31_000_000);
    expect(totals.linesDiscount.amount).toBe(1_500_000);
    expect(totals.overallDiscount.amount).toBe(1_500_000);
    expect(totals.discount.amount).toBe(3_000_000);
    expect(totals.afterDiscount.amount).toBe(28_000_000);
    expect(totals.service.amount).toBe(2_800_000);
    expect(totals.total.amount).toBe(30_800_000);
    expect(totals.vat.amount).toBe(0);
    expect(totals.perGuest.amount).toBe(1_540_000);
  });

  it('extracts included VAT when the seller is a VAT payer (16%)', () => {
    const q = calculateQuote(input({ lines: [line({ quantity: 1, unitPrice: t(116_000) })], vat: { payer: true, rateBp: 1600 } }));
    expect(q.totals.total.amount).toBe(11_600_000);
    expect(q.totals.vat.amount).toBe(1_600_000);
  });

  it('applies overall percent discount after line discounts and rounds per guest half-up', () => {
    const q = calculateQuote(input({ lines: [line({ quantity: 1, unitPrice: Money.of(1000) })], discount: { type: 'percent', bp: 3333 }, guests: 3 }));
    expect(q.totals.overallDiscount.amount).toBe(333);
    expect(q.totals.total.amount).toBe(667);
    expect(q.totals.perGuest.amount).toBe(222);
  });

  it('rejects discounts exceeding the amount and invalid input', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        return (err as ValidationError).code;
      }
      return null;
    };
    expect(code(() => calculateQuote(input({ lines: [line({ quantity: 1, discount: { type: 'amount', amount: t(3_001) } })] })))).toBe(
      'banquet_quote.line_discount_exceeds',
    );
    expect(code(() => calculateQuote(input({ discount: { type: 'amount', amount: t(30_001) } })))).toBe('banquet_quote.discount_exceeds');
    expect(code(() => calculateQuote(input({ discount: { type: 'percent', bp: 10_001 } })))).toBe('banquet_quote.discount_invalid');
    expect(code(() => calculateQuote(input({ lines: [] })))).toBe('banquet_quote.no_lines');
    expect(code(() => calculateQuote(input({ lines: [line({ quantity: 0 })] })))).toBe('banquet_quote.invalid_quantity');
    expect(code(() => calculateQuote(input({ lines: [line({ quantity: 1.5 })] })))).toBe('banquet_quote.invalid_quantity');
    expect(code(() => calculateQuote(input({ lines: [line({ unitPrice: Money.of(-1) })] })))).toBe('banquet_quote.invalid_price');
    expect(code(() => calculateQuote(input({ lines: [line({ dishId: null })] })))).toBe('banquet_quote.dish_required');
    expect(code(() => calculateQuote(input({ lines: [line({ title: {} })] })))).toBe('banquet_quote.title_required');
    expect(code(() => calculateQuote(input({ lines: [line({ unit: ' ' })] })))).toBe('banquet_quote.invalid_unit');
    expect(code(() => calculateQuote(input({ serviceChargeBp: 5001 })))).toBe('banquet_quote.invalid_service_charge');
    expect(code(() => calculateQuote(input({ guests: 0 })))).toBe('banquet_quote.invalid_guests');
  });

  it('allows a 100% discount and zero prices', () => {
    const q = calculateQuote(input({ lines: [line({ discount: { type: 'percent', bp: 10_000 } }), line({ unitPrice: Money.zero() })] }));
    expect(q.totals.total.amount).toBe(0);
    expect(q.totals.perGuest.amount).toBe(0);
  });
});
