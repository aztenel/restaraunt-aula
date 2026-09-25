/** Отображение броней: время в часовом поясе филиала, подписи мест, ссылки на контакты гостя. */
import { translate, type Translatable } from '@aula/api-client';
import { dayjs } from '@/shared/lib/dates';

export const DEFAULT_TZ = 'Asia/Almaty';

export function formatInTz(value: string | null | undefined, tz: string, format = 'DD.MM.YYYY HH:mm'): string {
  if (!value) return '—';
  const d = dayjs(value);
  return d.isValid() ? d.tz(tz).format(format) : '—';
}

export function formatTimeRange(start: string, end: string, tz: string): string {
  return `${formatInTz(start, tz, 'HH:mm')}–${formatInTz(end, tz, 'HH:mm')}`;
}

/** «19:30, пт 25.10» — локальная дата брони (YYYY-MM-DD) и время. */
export function formatLocalDate(date: string, format = 'dd, DD.MM.YYYY'): string {
  const d = dayjs(date);
  return d.isValid() ? d.format(format) : date;
}

/** Название места с кодом: «Юрта 1 · Y1» (код не дублируется, если совпадает с названием). */
export function venueTitle(venue: { name: Translatable; code: string }, language: string): string {
  const name = translate(venue.name, language);
  if (!name) return venue.code;
  return name === venue.code ? name : `${name} · ${venue.code}`;
}

/** Ссылка WhatsApp по номеру +7XXXXXXXXXX. */
export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}`;
}

export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}
