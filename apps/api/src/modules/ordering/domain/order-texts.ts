import { MINOR_UNITS_PER_MAJOR, Money } from '../../../shared/kernel/money';
import { toLocalDate, toLocalTime } from '../../../shared/kernel/time';
import { Locale } from '../../../shared/kernel/translatable';
import { OrderType } from '../public';
import { CancelReasonCode } from './order-status';

/**
 * Тексты для уведомлений (параметры шаблонов — уже отформатированные строки).
 * Фронтенд форматирует суммы сам; здесь — только для сообщений гостю и персоналу.
 */

/** «12 500 ₸», «1 500,50 ₸». Только целочисленная арифметика. */
export function formatMoney(money: Money): string {
  const sign = money.amount < 0 ? '-' : '';
  const abs = Math.abs(money.amount);
  const major = Math.floor(abs / MINOR_UNITS_PER_MAJOR);
  const minor = abs % MINOR_UNITS_PER_MAJOR;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const symbol = money.currency === 'KZT' ? '₸' : money.currency;
  return `${sign}${grouped}${minor ? `,${String(minor).padStart(2, '0')}` : ''} ${symbol}`;
}

/** Время для гостя: «19:30» (сегодня) или «26.09 19:30». */
export function formatEta(at: Date, now: Date, timezone: string): string {
  const time = toLocalTime(at, timezone);
  const date = toLocalDate(at, timezone);
  if (date === toLocalDate(now, timezone)) return time;
  const [, month, day] = date.split('-');
  return `${day}.${month} ${time}`;
}

const TYPE_LABELS: Record<OrderType, Record<Locale, string>> = {
  delivery: { ru: 'Доставка', kk: 'Жеткізу', en: 'Delivery' },
  pickup: { ru: 'Самовывоз', kk: 'Өзі алып кету', en: 'Pickup' },
};

export function orderTypeLabel(type: OrderType, locale: Locale): string {
  return TYPE_LABELS[type][locale];
}

const CANCEL_REASON_LABELS: Record<CancelReasonCode, Record<Locale, string>> = {
  guest_request: { ru: 'по вашей просьбе', kk: 'сіздің өтінішіңіз бойынша', en: 'at your request' },
  not_paid_in_time: { ru: 'заказ не был оплачен вовремя', kk: 'тапсырыс уақытында төленбеді', en: 'the order was not paid in time' },
  out_of_stock: { ru: 'часть блюд закончилась', kk: 'кейбір тағамдар таусылды', en: 'some dishes are out of stock' },
  cannot_deliver: { ru: 'мы не можем доставить заказ', kk: 'тапсырысты жеткізе алмаймыз', en: 'we cannot deliver the order' },
  duplicate: { ru: 'повторный заказ', kk: 'қайталанған тапсырыс', en: 'duplicate order' },
  other: { ru: 'по техническим причинам', kk: 'техникалық себептер бойынша', en: 'for technical reasons' },
};

export function cancelReasonLabel(code: CancelReasonCode, locale: Locale): string {
  return CANCEL_REASON_LABELS[code][locale];
}
