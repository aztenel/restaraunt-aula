import { MINOR_UNITS_PER_MAJOR, Money } from '../../../shared/kernel/money';
import { DEFAULT_TIMEZONE, zonedParts } from '../../../shared/kernel/time';
import { Locale } from '../../../shared/kernel/translatable';
import { DepositOutcome } from './deposit-policy';

/**
 * Строки для уведомлений гостю (шаблоны Notifications получают уже отформатированные значения).
 * Только целочисленная арифметика по суммам.
 */

/** «50 000 ₸», «1 500,50 ₸». */
export function formatTenge(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = money.currency === 'KZT' ? '₸' : money.currency;
  return minor === 0 ? `${sign}${grouped} ${symbol}` : `${sign}${grouped},${String(minor).padStart(2, '0')} ${symbol}`;
}

/** Локальная дата филиала: «25.10.2026». */
export function formatLocalDate(at: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.day).padStart(2, '0')}.${String(p.month).padStart(2, '0')}.${p.year}`;
}

/** Локальное время филиала: «19:30». */
export function formatLocalTime(at: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(at, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** «19:30, 25.10.2026» — срок удержания брони. */
export function formatLocalDateTime(at: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  return `${formatLocalTime(at, timeZone)}, ${formatLocalDate(at, timeZone)}`;
}

const DEPOSIT_NOTES: Record<Exclude<DepositOutcome, 'none'>, Record<Locale, string>> = {
  refunded: {
    ru: 'Депозит будет возвращён на карту, срок зачисления зависит от банка.',
    kk: 'Депозит картаңызға қайтарылады, түсу мерзімі банкке байланысты.',
    en: 'The deposit will be refunded to your card; timing depends on your bank.',
  },
  retained: {
    ru: 'Депозит удержан согласно правилам отмены брони.',
    kk: 'Депозит брондаудан бас тарту ережелеріне сәйкес ұсталды.',
    en: 'The deposit has been retained according to the cancellation policy.',
  },
};

/** Пояснение о депозите в уведомлении об отмене. */
export function depositNote(outcome: DepositOutcome, locale: Locale): string {
  return outcome === 'none' ? '' : DEPOSIT_NOTES[outcome][locale];
}
