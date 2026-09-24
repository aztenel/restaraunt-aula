import { ValidationError } from '../../../shared/kernel/errors';
import { Currency, DEFAULT_CURRENCY, MINOR_UNITS_PER_MAJOR, Money } from '../../../shared/kernel/money';

/**
 * Преобразования сумм для внешних систем и текстов. Только целочисленная арифметика:
 * провайдеры принимают/возвращают тенге с копейками («1500.50»), у нас — тиыны.
 */

/** 150050 тиынов -> «1500.50». */
export function toMajorString(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  return `${sign}${major}.${String(minor).padStart(2, '0')}`;
}

const MAJOR_RE = /^(-)?(\d{1,13})(?:[.,](\d{1,2}))?$/;

/**
 * «1500.5» / 1500.5 / «1500,50» / 1500 -> Money в тиынах. Разбор строки, без float-умножения.
 * Больше двух знаков после запятой — ошибка (провайдер прислал что-то неожиданное).
 */
export function parseMajorAmount(value: string | number, currency: Currency = DEFAULT_CURRENCY): Money {
  const text = typeof value === 'number' ? String(value) : String(value ?? '').trim();
  const match = MAJOR_RE.exec(text);
  if (!match) {
    throw new ValidationError('money.invalid_major_amount', `Cannot parse amount ${text}`, { value: text });
  }
  const [, minus, major, minor] = match;
  const minorUnits = Number(major) * MINOR_UNITS_PER_MAJOR + Number((minor ?? '').padEnd(2, '0') || '0');
  return Money.of(minus ? -minorUnits : minorUnits, currency);
}

/** Для сообщений гостю и PDF: «5 000 ₸», «1 500,50 ₸». Фронтенд форматирует сам. */
export function formatTenge(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = money.currency === 'KZT' ? '₸' : money.currency;
  return minor === 0 ? `${sign}${grouped} ${symbol}` : `${sign}${grouped},${String(minor).padStart(2, '0')} ${symbol}`;
}
