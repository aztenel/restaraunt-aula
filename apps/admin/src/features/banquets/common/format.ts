/**
 * Подписи для раздела банкетов: даты мероприятий (локальные 'YYYY-MM-DD'), краткие описания записей
 * ленты заявки из их data. Ничего не считает — только форматирует то, что пришло с сервера.
 */
import type { TFunction } from 'i18next';
import { formatMoney, type Money } from '@aula/api-client';
import { tx } from '@/shared/i18n/tx';
import { dayjs, formatDateTime, toDisplay } from '@/shared/lib/dates';

/** '2026-11-14' + '18:00' → «14.11.2026, сб, 18:00». */
export function formatEventDate(date: string | null | undefined, time?: string | null, withWeekday = true): string {
  if (!date) return '—';
  const d = dayjs(date);
  if (!d.isValid()) return date;
  const parts = [d.format('DD.MM.YYYY')];
  if (withWeekday) parts.push(d.format('dd'));
  if (time) parts.push(time);
  return parts.join(', ');
}

/** 'YYYY-MM-DD' → «14.11.2026». */
export function formatIsoDate(date: string | null | undefined): string {
  if (!date) return '—';
  const d = dayjs(date);
  return d.isValid() ? d.format('DD.MM.YYYY') : date;
}

/** Интервал занятости зала (ISO UTC) → «14.11.2026 17:00 — 23:30» в Asia/Almaty. */
export function formatInterval(start: string, end: string): string {
  const s = toDisplay(start);
  const e = toDisplay(end);
  if (!s || !e) return '—';
  const sameDay = s.format('YYYY-MM-DD') === e.format('YYYY-MM-DD');
  return `${s.format('DD.MM.YYYY HH:mm')} — ${sameDay ? e.format('HH:mm') : e.format('DD.MM.YYYY HH:mm')}`;
}

export function isMoney(value: unknown): value is Money {
  return Boolean(value && typeof value === 'object' && typeof (value as { amount?: unknown }).amount === 'number');
}

/** Поля заявки (ключи auditView) → подписи формы. */
const CHANGED_FIELD_KEYS: Record<string, string> = {
  eventDate: 'banquets.form.eventDate',
  eventTime: 'banquets.form.eventTime',
  eventType: 'banquets.form.eventType',
  guests: 'banquets.form.guests',
  budget: 'banquets.form.budget',
  branchId: 'banquets.form.branch',
  isOffsite: 'banquets.form.offsite',
  offsiteAddress: 'banquets.form.address',
  companyId: 'banquets.form.company',
  managerId: 'banquets.form.manager',
  venue: 'banquets.venue.title',
  wishes: 'banquets.form.wishes',
  prepaymentAmount: 'banquets.prepayment.amount',
};

/**
 * Краткое описание записи ленты по её data: смена статуса, версия и итог сметы, номер счёта, сумма,
 * зал и время, новый менеджер, изменённые поля, статус ЭСФ, минуты без ответа.
 */
export function activitySummary(t: TFunction, language: string, kind: string, data: Record<string, unknown>): string {
  const parts: string[] = [];
  const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : null);
  const from = str('from');
  const to = str('to');
  if (kind === 'status_changed' && to) {
    parts.push(`${from ? tx(t, `statuses.banquet.${from}`, from) : '—'} → ${tx(t, `statuses.banquet.${to}`, to)}`);
  }
  const managerName = str('managerName');
  if (managerName && (kind === 'assigned' || kind === 'created')) parts.push(managerName);
  if (typeof data.version === 'number') parts.push(tx(t, 'banquets.activity.quoteVersion', '', { version: data.version }));
  const number = str('number');
  if (number) parts.push(number);
  const documentKind = str('kind');
  if (kind === 'document_generated' && documentKind) parts.push(tx(t, `banquets.documents.kinds.${documentKind}`, documentKind));
  const venueName = str('venueName');
  const start = str('start');
  const end = str('end');
  if (venueName) parts.push(venueName);
  if (kind === 'venue_set' && start && end) parts.push(formatInterval(start, end));
  const money = isMoney(data.total) ? data.total : isMoney(data.amount) ? data.amount : null;
  if (money) parts.push(formatMoney(money, language));
  const method = str('method');
  if (method) parts.push(tx(t, `banquets.invoices.methods.${method}`, method));
  const payerType = str('payerType');
  if (payerType) parts.push(tx(t, `banquets.invoices.payerShort.${payerType}`, payerType));
  if (kind === 'esf' && str('status')) parts.push(tx(t, `banquets.documents.esf.statuses.${str('status')}`, str('status') ?? ''));
  if (kind === 'sla_breach' && typeof data.minutes === 'number') parts.push(tx(t, 'banquets.activity.slaMinutes', '', { minutes: data.minutes }));
  if (kind === 'details_updated' && Array.isArray(data.changed)) {
    const fields = (data.changed as unknown[])
      .filter((f): f is string => typeof f === 'string')
      .map((f) => (CHANGED_FIELD_KEYS[f] ? tx(t, CHANGED_FIELD_KEYS[f], f) : f));
    if (fields.length > 0) parts.push(tx(t, 'banquets.activity.changed', '', { fields: fields.join(', ') }));
  }
  const source = str('source');
  if (kind === 'created' && source) parts.unshift(tx(t, `banquets.sources.${source}`, source));
  return parts.join(' · ');
}

export { formatDateTime };
