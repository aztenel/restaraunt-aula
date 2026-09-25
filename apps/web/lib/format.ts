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

const KK_MONTHS = ['қаңтар', 'ақпан', 'наурыз', 'сәуір', 'мамыр', 'маусым', 'шілде', 'тамыз', 'қыркүйек', 'қазан', 'қараша', 'желтоқсан'];

/**
 * Казахский формат дат без данных ICU для kk: во многих браузерах (и в сборках Chromium без полного ICU)
 * Intl для kk-KZ молча откатывается на английский — серверная и клиентская разметка расходятся
 * (ошибка гидратации React #418) и гость видит английские месяцы. Части даты берём из en-GB (есть
 * везде), слова и порядок — как в CLDR kk: «2026 ж. 25 қыркүйек», «25 қыркүйек, 17:00».
 */
function formatKk(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  const parts: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)) {
    parts[part.type] = part.value;
  }
  const hasDate = Boolean(options.day || options.month || options.year);
  const hasTime = Boolean(options.hour || options.minute);
  const dayMonth = `${Number(parts.day)} ${KK_MONTHS[Number(parts.month) - 1] ?? ''}`;
  const datePart = options.year ? `${parts.year} ж. ${dayMonth}` : dayMonth;
  const time = `${parts.hour}:${parts.minute}`;
  if (hasDate && hasTime) return `${datePart}, ${time}`;
  return hasTime ? time : datePart;
}

function formatIn(date: Date, locale: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  if (locale === 'kk') return formatKk(date, timeZone, options);
  return new Intl.DateTimeFormat(intlLocale(locale), { timeZone, ...options }).format(date);
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
    return formatIn(date, locale, DISPLAY_TIME_ZONE, options);
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
    return formatIn(date, locale, 'UTC', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return ymd ?? '';
  }
}
