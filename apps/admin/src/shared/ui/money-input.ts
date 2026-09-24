/**
 * Логика поля ввода суммы: тенге строкой ⇄ целые тиыны. Без арифметики с плавающей точкой —
 * разбор по цифрам (parseTengeToTiyn из @aula/api-client).
 */
import { formatFixed2ForInput, formatMoney, parseTengeToTiyn, type ParseFixedError } from '@aula/api-client';

export interface MoneyInputParse {
  /** Тиыны; null — поле пустое или ошибка. */
  value: number | null;
  error: ParseFixedError | null;
}

export interface MoneyInputOptions {
  allowNegative?: boolean;
  /** Максимум в тиынах. */
  max?: number;
}

export function parseMoneyInput(text: string, options: MoneyInputOptions = {}): MoneyInputParse {
  if (text.trim() === '') return { value: null, error: null };
  const result = parseTengeToTiyn(text, options);
  return result.ok ? { value: result.value, error: null } : { value: null, error: result.error };
}

/** Значение для редактирования: 250050 → "2500,50". */
export function moneyToInputText(value: number | null | undefined, locale = 'ru'): string {
  return formatFixed2ForInput(value, locale);
}

/** Значение после ухода с поля: 250050 → "2 500,50" (с разделителями разрядов, без ₸ — он в суффиксе). */
export function moneyToDisplayText(value: number | null | undefined, locale = 'ru'): string {
  if (value === null || value === undefined) return '';
  return formatMoney({ amount: value, currency: 'KZT' }, locale, { withCurrency: false });
}
