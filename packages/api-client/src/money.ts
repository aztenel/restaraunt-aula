/**
 * Деньги на фронтенде — только отображение и ввод. Все суммы приходят с сервера
 * целыми числами в тиынах (1 ₸ = 100 тиынов) вместе с валютой. Никаких вычислений
 * цен и итогов на клиенте (правило ТЗ №6 и №8) и никакой арифметики с плавающей точкой:
 * форматирование и разбор ввода работают со строками и целыми числами.
 */
import type { Locale } from './i18n';

export type Currency = 'KZT';

export interface Money {
  /** Целое число минимальных единиц (тиынов). */
  amount: number;
  currency: Currency;
}

export const MINOR_UNITS_PER_MAJOR = 100;

const CURRENCY_SYMBOL: Record<Currency, string> = { KZT: '₸' };

/** Узкий неразрывный пробел — разделитель разрядов («2 500»), не переносится на новую строку. */
export const GROUP_SEPARATOR = ' ';
/** Неразрывный пробел между числом и знаком валюты. */
export const CURRENCY_SEPARATOR = ' ';
/** Типографский минус для отрицательных сумм (возвраты, скидки). */
export const MINUS_SIGN = '−';

function groupDigits(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    const fromEnd = digits.length - i;
    out += digits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += GROUP_SEPARATOR;
  }
  return out;
}

function decimalSeparator(locale: Locale | string): string {
  return locale.startsWith('en') ? '.' : ',';
}

export interface FormatMoneyOptions {
  /** Показывать знак валюты (по умолчанию да). */
  withCurrency?: boolean;
  /** Всегда показывать копейки/тиыны ("2 500,00 ₸"). По умолчанию — только если сумма не целая. */
  alwaysShowMinor?: boolean;
  /** Текст для отсутствующей суммы. */
  empty?: string;
}

/**
 * Форматирует сумму в тиынах: { amount: 250000 } → "2 500 ₸", { amount: 250050 } → "2 500,50 ₸".
 * Разделитель разрядов — узкий неразрывный пробел, десятичный — запятая (kk, ru) или точка (en).
 */
export function formatMoney(
  money: Money | null | undefined,
  locale: Locale | string = 'ru',
  options: FormatMoneyOptions = {},
): string {
  if (!money || typeof money.amount !== 'number' || !Number.isFinite(money.amount)) {
    return options.empty ?? '—';
  }
  const amount = Math.trunc(money.amount);
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  // (abs - minor) кратно 100 — деление точное.
  const major = (abs - minor) / MINOR_UNITS_PER_MAJOR;
  let text = groupDigits(String(major));
  if (minor !== 0 || options.alwaysShowMinor) {
    text += decimalSeparator(locale) + String(minor).padStart(2, '0');
  }
  if (negative) text = MINUS_SIGN + text;
  if (options.withCurrency === false) return text;
  const symbol = CURRENCY_SYMBOL[money.currency] ?? money.currency;
  return `${text}${CURRENCY_SEPARATOR}${symbol}`;
}

/** Удобная обёртка: сумма в тиынах без объекта Money (валюта — тенге). */
export function formatTiyn(amount: number | null | undefined, locale: Locale | string = 'ru', options?: FormatMoneyOptions): string {
  return formatMoney(amount === null || amount === undefined ? null : { amount, currency: 'KZT' }, locale, options);
}

export type ParseFixedError = 'empty' | 'invalid' | 'too_many_decimals' | 'negative' | 'too_large';

export type ParseFixedResult = { ok: true; value: number } | { ok: false; error: ParseFixedError };

export interface ParseFixedOptions {
  allowNegative?: boolean;
  /** Максимум в минимальных единицах (по умолчанию Number.MAX_SAFE_INTEGER). */
  max?: number;
}

/**
 * Разбор десятичного числа с точностью до сотых в целое число сотых БЕЗ плавающей точки:
 * "2 500" → 250000, "2500,5" → 250050, "0.05" → 5. Используется для ввода сумм в тенге
 * (результат — тиыны) и процентов (результат — базисные пункты: "16" → 1600).
 */
export function parseFixed2(input: string, options: ParseFixedOptions = {}): ParseFixedResult {
  const cleaned = input
    .trim()
    .replace(/[\s   ₸%]/g, '')
    .replace(MINUS_SIGN, '-');
  if (cleaned === '' || cleaned === '-') return { ok: false, error: 'empty' };
  const match = /^(-)?(\d*)(?:[.,](\d*))?$/.exec(cleaned);
  if (!match) return { ok: false, error: 'invalid' };
  const [, sign, intPartRaw = '', fracPartRaw = ''] = match;
  if (intPartRaw === '' && fracPartRaw === '') return { ok: false, error: 'invalid' };
  if (fracPartRaw.length > 2) return { ok: false, error: 'too_many_decimals' };
  if (sign && !options.allowNegative) return { ok: false, error: 'negative' };
  const intPart = intPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const fracPart = fracPartRaw.padEnd(2, '0');
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  const max = options.max ?? Number.MAX_SAFE_INTEGER;
  // Сравнение по длине строки до преобразования в число — без потери точности на больших значениях.
  if (digits.length > String(Number.MAX_SAFE_INTEGER).length) return { ok: false, error: 'too_large' };
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value > max) return { ok: false, error: 'too_large' };
  return { ok: true, value: sign && value !== 0 ? -value : value };
}

/** Ввод суммы в тенге → тиыны. */
export function parseTengeToTiyn(input: string, options?: ParseFixedOptions): ParseFixedResult {
  return parseFixed2(input, options);
}

/**
 * Целое число сотых → строка для поля ввода: 250000 → "2500", 250050 → "2500,50".
 * Без разделителей разрядов (их вставляет форматирование при отображении).
 */
export function formatFixed2ForInput(value: number | null | undefined, locale: Locale | string = 'ru'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const int = Math.trunc(value);
  const negative = int < 0;
  const abs = Math.abs(int);
  const minor = abs % 100;
  const major = (abs - minor) / 100;
  const text = minor === 0 ? String(major) : `${major}${decimalSeparator(locale)}${String(minor).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}
