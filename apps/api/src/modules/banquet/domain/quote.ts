import { ValidationError } from '../../../shared/kernel/errors';
import { Currency, DEFAULT_CURRENCY, Money } from '../../../shared/kernel/money';
import { assertTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { divideMoney } from './money-format';
import { QUOTE_LINE_KINDS, QuoteLineKind } from './texts';

/**
 * Расчёт банкетной сметы. Все суммы — целые тиыны, расчёт только на сервере.
 *
 *   сумма строки      = цена × количество
 *   скидка строки     = процент (bp) или сумма, не больше суммы строки
 *   подытог           = Σ сумм строк (до скидок)
 *   после скидок      = подытог − скидки строк − общая скидка (процент или сумма, не больше остатка)
 *   обслуживание      = после скидок × процент обслуживания (bp)
 *   итого             = после скидок + обслуживание
 *   НДС               = если продавец — плательщик НДС, НДС включён в цены и выделяется из итога («в т.ч. НДС»)
 *   на гостя          = итого / гостей (округление half-up)
 */

export const MAX_QUOTE_LINES = 300;
export const MAX_LINE_QUANTITY = 100_000;
/** Процент обслуживания не больше 50%. */
export const MAX_SERVICE_CHARGE_BP = 5000;

export type QuoteDiscount = { type: 'percent'; bp: number } | { type: 'amount'; amount: Money } | null;

export interface QuoteLineInput {
  kind: QuoteLineKind;
  /** Для позиций меню — блюдо (цена и название — снимок на момент добавления). */
  dishId: string | null;
  title: Translatable;
  unit: string;
  quantity: number;
  unitPrice: Money;
  discount: QuoteDiscount;
}

export interface CalculatedQuoteLine extends QuoteLineInput {
  position: number;
  gross: Money;
  discountAmount: Money;
  total: Money;
}

export interface QuoteTotals {
  subtotal: Money;
  /** Скидки строк + общая скидка. */
  discount: Money;
  linesDiscount: Money;
  overallDiscount: Money;
  afterDiscount: Money;
  service: Money;
  total: Money;
  /** НДС, включённый в итог (0, если продавец не плательщик НДС). */
  vat: Money;
  perGuest: Money;
}

export interface QuoteCalculationInput {
  lines: readonly QuoteLineInput[];
  discount: QuoteDiscount;
  serviceChargeBp: number;
  vat: { payer: boolean; rateBp: number };
  guests: number;
  currency?: Currency;
}

export interface QuoteCalculation {
  lines: CalculatedQuoteLine[];
  totals: QuoteTotals;
}

function discountOf(base: Money, discount: QuoteDiscount, code: string): Money {
  if (!discount) return Money.zero(base.currency);
  if (discount.type === 'percent') {
    if (!Number.isInteger(discount.bp) || discount.bp < 0 || discount.bp > 10_000) {
      throw new ValidationError(`${code}_invalid`, 'Discount percent must be 0..100% (0..10000 bp)');
    }
    return base.percentage(discount.bp);
  }
  if (discount.amount.isNegative()) throw new ValidationError(`${code}_invalid`, 'Discount cannot be negative');
  if (discount.amount.greaterThan(base)) {
    throw new ValidationError(`${code}_exceeds`, 'Discount cannot exceed the amount it applies to', {
      amount: discount.amount.toJSON(),
      base: base.toJSON(),
    });
  }
  return discount.amount;
}

function validateLine(line: QuoteLineInput, index: number): QuoteLineInput {
  const at = { line: index + 1 };
  if (!(QUOTE_LINE_KINDS as readonly string[]).includes(line.kind)) {
    throw new ValidationError('banquet_quote.invalid_line_kind', 'Unknown line kind', { ...at, kind: line.kind });
  }
  if (line.kind === 'menu' && !line.dishId) throw new ValidationError('banquet_quote.dish_required', 'Menu line needs a dish', at);
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) {
    throw new ValidationError('banquet_quote.invalid_quantity', `Quantity must be an integer 1..${MAX_LINE_QUANTITY}`, at);
  }
  if (line.unitPrice.isNegative()) throw new ValidationError('banquet_quote.invalid_price', 'Price cannot be negative', at);
  const unit = line.unit.trim();
  if (!unit || unit.length > 20) throw new ValidationError('banquet_quote.invalid_unit', 'Unit is required (up to 20 chars)', at);
  let title: Translatable;
  try {
    title = assertTranslatable(line.title, 'title');
  } catch {
    throw new ValidationError('banquet_quote.title_required', 'Line title is required (ru or kk)', at);
  }
  return { ...line, unit, title, dishId: line.kind === 'menu' ? line.dishId : null };
}

export function calculateQuote(input: QuoteCalculationInput): QuoteCalculation {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  if (input.lines.length === 0) throw new ValidationError('banquet_quote.no_lines', 'Quote must have at least one line');
  if (input.lines.length > MAX_QUOTE_LINES) {
    throw new ValidationError('banquet_quote.too_many_lines', `No more than ${MAX_QUOTE_LINES} lines`);
  }
  if (!Number.isInteger(input.guests) || input.guests < 1) throw new ValidationError('banquet_quote.invalid_guests', 'Guests must be positive');
  if (!Number.isInteger(input.serviceChargeBp) || input.serviceChargeBp < 0 || input.serviceChargeBp > MAX_SERVICE_CHARGE_BP) {
    throw new ValidationError('banquet_quote.invalid_service_charge', 'Service charge must be 0..50% (0..5000 bp)');
  }
  const lines: CalculatedQuoteLine[] = input.lines.map((raw, index) => {
    const line = validateLine(raw, index);
    const gross = line.unitPrice.multiply(line.quantity);
    const discountAmount = discountOf(gross, line.discount, 'banquet_quote.line_discount');
    return { ...line, position: index + 1, gross, discountAmount, total: gross.subtract(discountAmount) };
  });
  const subtotal = Money.sum(lines.map((l) => l.gross), currency);
  const linesDiscount = Money.sum(lines.map((l) => l.discountAmount), currency);
  const afterLines = subtotal.subtract(linesDiscount);
  const overallDiscount = discountOf(afterLines, input.discount, 'banquet_quote.discount');
  const afterDiscount = afterLines.subtract(overallDiscount);
  const service = afterDiscount.percentage(input.serviceChargeBp);
  const total = afterDiscount.add(service);
  const vat = input.vat.payer ? total.includedTax(input.vat.rateBp) : Money.zero(currency);
  return {
    lines,
    totals: {
      subtotal,
      discount: linesDiscount.add(overallDiscount),
      linesDiscount,
      overallDiscount,
      afterDiscount,
      service,
      total,
      vat,
      perGuest: divideMoney(total, input.guests),
    },
  };
}
