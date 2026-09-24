import { Money, MINOR_UNITS_PER_MAJOR } from '../../../shared/kernel/money';

/**
 * Расчёты для отчётов. Деньги — только целые тиыны (Money), без float:
 * среднее округляется half-up до целого тиына в BigInt.
 */

/** Среднее (средний чек): total / count, half-up от нуля. count = 0 — ноль. */
export function averageAmount(total: Money, count: number): Money {
  if (!Number.isSafeInteger(count) || count <= 0) return Money.zero(total.currency);
  const num = BigInt(total.amount);
  const den = BigInt(count);
  const abs = num < 0n ? -num : num;
  const rounded = (abs * 2n + den) / (den * 2n);
  return Money.of(Number(num < 0n ? -rounded : rounded), total.currency);
}

/**
 * Доля/конверсия (не деньги): numerator / denominator с точностью 4 знака (0.1234 = 12.34%).
 * Знаменатель 0 — null (показатель не определён).
 */
export function ratio(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator * 10_000) / denominator) / 10_000;
}

/** Сумма денег из целых тиынов (строки SQL bigint приходят числами). */
export function money(amount: number | null | undefined): Money {
  return Money.of(Number(amount ?? 0));
}

function groupThousands(value: bigint): string {
  const digits = value.toString();
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ' ';
    out += digits[i];
  }
  return out;
}

/** «1 234 567 ₸» / «1 234 567,50 ₸» — для текстов уведомлений персоналу. */
export function formatTenge(value: Money): string {
  const amount = BigInt(value.amount);
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const unit = BigInt(MINOR_UNITS_PER_MAJOR);
  const major = abs / unit;
  const minor = abs % unit;
  const minorText = minor === 0n ? '' : `,${minor.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}${groupThousands(major)}${minorText} ₸`;
}

/** «1234.50» — десятичная запись суммы для обмена с учётной системой (XML). */
export function formatDecimal(amount: number): string {
  const value = BigInt(amount);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = BigInt(MINOR_UNITS_PER_MAJOR);
  return `${negative ? '-' : ''}${(abs / unit).toString()}.${(abs % unit).toString().padStart(2, '0')}`;
}

/** Сумма списка Money (пустой список — ноль). */
export function sumMoney(values: readonly Money[]): Money {
  return Money.sum(values);
}
