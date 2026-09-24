import { InvariantViolationError, ValidationError } from './errors';

/**
 * Деньги — целые числа в минимальных единицах (тиыны для KZT). Никаких float.
 * Каждая сумма хранится вместе с валютой, даже пока валюта одна (правило схемы).
 */
export const CURRENCIES = ['KZT'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'KZT';

/** 1 тенге = 100 тиынов. */
export const MINOR_UNITS_PER_MAJOR = 100;

export interface MoneyJson {
  amount: number;
  currency: Currency;
}

export class Money {
  private constructor(
    readonly amount: number,
    readonly currency: Currency,
  ) {}

  static of(amount: number, currency: Currency = DEFAULT_CURRENCY): Money {
    if (!Number.isSafeInteger(amount)) {
      throw new ValidationError('money.not_integer', `Money amount must be an integer number of minor units, got ${amount}`);
    }
    if (!(CURRENCIES as readonly string[]).includes(currency)) {
      throw new ValidationError('money.unknown_currency', `Unknown currency ${currency}`);
    }
    return new Money(amount, currency);
  }

  static zero(currency: Currency = DEFAULT_CURRENCY): Money {
    return new Money(0, currency);
  }

  /** Удобство для сидов и тестов: целое число тенге -> тиыны. */
  static tenge(tenge: number): Money {
    if (!Number.isSafeInteger(tenge)) {
      throw new ValidationError('money.not_integer', 'Tenge amount must be an integer');
    }
    return Money.of(tenge * MINOR_UNITS_PER_MAJOR);
  }

  static fromJson(json: MoneyJson): Money {
    return Money.of(json.amount, json.currency);
  }

  static sum(items: readonly Money[], currency: Currency = DEFAULT_CURRENCY): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount + other.amount, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return Money.of(this.amount - other.amount, this.currency);
  }

  /** Умножение на целое количество (порции, штуки). */
  multiply(quantity: number): Money {
    if (!Number.isSafeInteger(quantity)) {
      throw new ValidationError('money.quantity_not_integer', 'Quantity must be an integer');
    }
    return Money.of(this.amount * quantity, this.currency);
  }

  /**
   * Доля в базисных пунктах (1% = 100 bp). Округление half-up от нуля, до целого тиына.
   * Промежуточные вычисления в BigInt — без потери точности.
   */
  percentage(basisPoints: number): Money {
    if (!Number.isSafeInteger(basisPoints)) {
      throw new ValidationError('money.bp_not_integer', 'Basis points must be an integer');
    }
    const product = BigInt(this.amount) * BigInt(basisPoints);
    const divisor = 10_000n;
    const sign = product < 0n ? -1n : 1n;
    const abs = product < 0n ? -product : product;
    const rounded = (abs + divisor / 2n) / divisor;
    return Money.of(Number(sign * rounded), this.currency);
  }

  /**
   * НДС, включённый в сумму: amount * rate / (10000 + rate), half-up.
   */
  includedTax(rateBasisPoints: number): Money {
    if (rateBasisPoints === 0) return Money.zero(this.currency);
    const num = BigInt(this.amount) * BigInt(rateBasisPoints);
    const den = 10_000n + BigInt(rateBasisPoints);
    const rounded = (num * 2n + den) / (den * 2n);
    return Money.of(Number(rounded), this.currency);
  }

  negate(): Money {
    return Money.of(-this.amount, this.currency);
  }

  isZero(): boolean {
    return this.amount === 0;
  }

  isNegative(): boolean {
    return this.amount < 0;
  }

  isPositive(): boolean {
    return this.amount > 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount === other.amount;
  }

  greaterThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount > other.amount;
  }

  greaterThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount >= other.amount;
  }

  lessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount < other.amount;
  }

  lessThanOrEqual(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.amount <= other.amount;
  }

  min(other: Money): Money {
    return this.lessThanOrEqual(other) ? this : other;
  }

  max(other: Money): Money {
    return this.greaterThanOrEqual(other) ? this : other;
  }

  /** Не даёт уйти в минус: max(0, this). */
  clampToZero(): Money {
    return this.isNegative() ? Money.zero(this.currency) : this;
  }

  toJSON(): MoneyJson {
    return { amount: this.amount, currency: this.currency };
  }

  /** Только для логов и документов. Отображение на фронте форматирует сам фронт. */
  toString(): string {
    const major = Math.trunc(this.amount / MINOR_UNITS_PER_MAJOR);
    const minor = Math.abs(this.amount % MINOR_UNITS_PER_MAJOR);
    return `${major}.${minor.toString().padStart(2, '0')} ${this.currency}`;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new InvariantViolationError('money.currency_mismatch', `${this.currency} vs ${other.currency}`);
    }
  }
}
