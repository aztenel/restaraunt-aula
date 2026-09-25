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

/** Часовой пояс отображения (ТЗ: хранение в UTC, показ в Asia/Almaty). */
export const DISPLAY_TIME_ZONE = 'Asia/Almaty';

const INTL_LOCALE: Record<string, string> = { kk: 'kk-KZ', ru: 'ru-RU', en: 'en-GB' };

function intlLocale(locale: string): string {
  return INTL_LOCALE[locale] ?? locale;
}

/** Дата (ISO от сервера) на языке интерфейса в Asia/Almaty: «25 сентября 2026 г.». */
export function formatDate(
  value: string | Date | null | undefined,
  locale: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: DISPLAY_TIME_ZONE, ...options }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** Дата и время в Asia/Almaty: «25 сентября, 18:30». */
export function formatDateTime(value: string | Date | null | undefined, locale: string): string {
  return formatDate(value, locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
}

/** Календарная дата 'YYYY-MM-DD' (уже локальная, например validUntil) — без сдвига часового пояса. */
export function formatLocalDate(ymd: string | null | undefined, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!match) return ymd ?? '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  } catch {
    return ymd ?? '';
  }
}
