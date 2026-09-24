/**
 * Форматирование для отображения (не расчёты): деньги, телефоны, ссылки на WhatsApp и карты.
 */
import { formatMoney, type Money } from '@aula/api-client';

/** Цена/сумма от сервера на языке интерфейса: 250000 тиынов → «2 500 ₸». */
export function formatPrice(money: Money | null | undefined, locale: string): string {
  return formatMoney(money, locale);
}

/** Только цифры и ведущий «+» для tel:. */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits}`;
}

/** Ссылка на чат WhatsApp: https://wa.me/77001234567 (номер без «+» и пробелов). */
export function whatsappHref(phone: string, text?: string): string {
  const digits = phone.replace(/\D/g, '');
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${query}`;
}

/** Телефон для отображения: +77172000000 → +7 717 200 00 00 (казахстанский формат). */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
  }
  return phone;
}

/** Маршрут до филиала в Яндекс Картах (от текущего местоположения гостя). */
export function yandexRouteHref(lat: number, lng: number): string {
  return `https://yandex.kz/maps/?rtext=~${lat},${lng}&rtt=auto`;
}

/** Точка в Google Картах. */
export function googleMapsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
