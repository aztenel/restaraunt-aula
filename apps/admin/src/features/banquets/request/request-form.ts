/**
 * Форма заявки на банкет из админки (звонок, визит) и правка деталей: форма ⇄ API.
 * Поля — как в ТЗ: дата, тип мероприятия, гости, филиал или выезд (адрес), бюджет, контакт, пожелания.
 * Проверки — подсказки теми же правилами, что на сервере (validateDetails, normalizeContact).
 */
import { moneyInput, type BanquetEventType, type BanquetRequestDetail, type CreateRequestInput, type UpdateRequestInput } from '../types';

export const MAX_GUESTS = 5000;
export const MAX_DAYS_AHEAD = 730;
export const MAX_ADDRESS_LENGTH = 500;
export const MAX_WISHES_LENGTH = 4000;

export interface RequestFormValues {
  eventDate: string | null;
  eventTime: string | null;
  eventType: BanquetEventType | null;
  guests: number | null;
  offsite: boolean;
  /** Филиал проведения или филиал-исполнитель выезда. */
  branchId: string | null;
  address: string;
  /** Бюджет, тиыны. */
  budget: number | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  wishes: string;
  companyId: string | null;
  /** Только при создании: ответственный (иначе — автоназначение) и язык общения. */
  managerId: string | null;
  locale: 'ru' | 'kk' | 'en';
  /** Согласие гостя, полученное менеджером (по телефону / лично). */
  consentPersonalData: boolean;
  consentMarketing: boolean;
}

export type RequestFormIssue =
  | 'eventDateRequired'
  | 'eventDateInPast'
  | 'eventDateTooFar'
  | 'eventTimeInvalid'
  | 'eventTypeRequired'
  | 'guestsInvalid'
  | 'branchRequired'
  | 'addressRequired'
  | 'addressTooLong'
  | 'budgetInvalid'
  | 'contactNameRequired'
  | 'contactPhoneInvalid'
  | 'contactEmailInvalid'
  | 'wishesTooLong';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function addDaysIso(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export function emptyRequestForm(defaults: { branchId: string | null; locale?: 'ru' | 'kk' }): RequestFormValues {
  return {
    eventDate: null,
    eventTime: null,
    eventType: null,
    guests: null,
    offsite: false,
    branchId: defaults.branchId,
    address: '',
    budget: null,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    wishes: '',
    companyId: null,
    managerId: null,
    locale: defaults.locale ?? 'ru',
    consentPersonalData: false,
    consentMarketing: false,
  };
}

export function detailToForm(detail: BanquetRequestDetail): RequestFormValues {
  return {
    eventDate: detail.eventDate,
    eventTime: detail.eventTime,
    eventType: detail.eventType,
    guests: detail.guests,
    offsite: detail.isOffsite,
    branchId: detail.branchId,
    address: detail.offsiteAddress ?? '',
    budget: detail.budget?.amount ?? null,
    contactName: detail.contact.name,
    contactPhone: detail.contact.phone,
    contactEmail: detail.contact.email ?? '',
    wishes: detail.wishes ?? '',
    companyId: detail.company?.id ?? null,
    managerId: detail.managerId,
    locale: detail.locale === 'kk' || detail.locale === 'en' ? detail.locale : 'ru',
    consentPersonalData: true,
    consentMarketing: false,
  };
}

/** Телефон: не меньше 10 цифр (нормализацию в +7XXXXXXXXXX делает сервер). */
export function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Проверка формы. Дата в прошлом/слишком далеко проверяется только для новой заявки или при смене даты
 * (как на сервере: checkDate).
 */
export function validateRequestForm(values: RequestFormValues, context: { today: string; originalEventDate?: string | null }): RequestFormIssue[] {
  const issues: RequestFormIssue[] = [];
  if (!values.eventDate) issues.push('eventDateRequired');
  else if (values.eventDate !== context.originalEventDate) {
    if (values.eventDate < context.today) issues.push('eventDateInPast');
    else if (values.eventDate > addDaysIso(context.today, MAX_DAYS_AHEAD)) issues.push('eventDateTooFar');
  }
  if (values.eventTime && !TIME_RE.test(values.eventTime)) issues.push('eventTimeInvalid');
  if (!values.eventType) issues.push('eventTypeRequired');
  if (values.guests === null || !Number.isInteger(values.guests) || values.guests < 1 || values.guests > MAX_GUESTS) issues.push('guestsInvalid');
  if (!values.offsite && !values.branchId) issues.push('branchRequired');
  if (values.offsite) {
    const address = values.address.trim();
    if (!address) issues.push('addressRequired');
    else if (address.length > MAX_ADDRESS_LENGTH) issues.push('addressTooLong');
  }
  if (values.budget !== null && (!Number.isSafeInteger(values.budget) || values.budget < 0)) issues.push('budgetInvalid');
  if (!values.contactName.trim()) issues.push('contactNameRequired');
  if (!looksLikePhone(values.contactPhone)) issues.push('contactPhoneInvalid');
  const email = values.contactEmail.trim();
  if (email && !EMAIL_RE.test(email)) issues.push('contactEmailInvalid');
  if (values.wishes.trim().length > MAX_WISHES_LENGTH) issues.push('wishesTooLong');
  return issues;
}

function contactOf(values: RequestFormValues) {
  const email = values.contactEmail.trim();
  return { name: values.contactName.trim(), phone: values.contactPhone.trim(), ...(email ? { email } : {}) };
}

export function toCreateInput(values: RequestFormValues): CreateRequestInput {
  const wishes = values.wishes.trim();
  const address = values.address.trim();
  return {
    eventDate: values.eventDate ?? '',
    ...(values.eventTime ? { eventTime: values.eventTime } : {}),
    eventType: values.eventType ?? 'other',
    guests: values.guests ?? 0,
    ...(values.branchId ? { branchId: values.branchId } : {}),
    ...(values.offsite ? { offsite: true, address } : {}),
    ...(values.budget !== null ? { budget: moneyInput(values.budget) } : {}),
    contact: contactOf(values),
    ...(wishes ? { wishes } : {}),
    ...(values.consentPersonalData ? { consent: { personalData: true, marketing: values.consentMarketing } } : {}),
    locale: values.locale,
    ...(values.managerId ? { managerId: values.managerId } : {}),
    ...(values.companyId ? { companyId: values.companyId } : {}),
  };
}

/** PATCH: все редактируемые поля (сервер сравнивает с текущими и пишет в ленту только изменения). */
export function toUpdateInput(values: RequestFormValues): UpdateRequestInput {
  const wishes = values.wishes.trim();
  const address = values.address.trim();
  return {
    eventDate: values.eventDate ?? undefined,
    eventTime: values.eventTime || null,
    eventType: values.eventType ?? undefined,
    guests: values.guests ?? undefined,
    budget: values.budget !== null ? moneyInput(values.budget) : null,
    branchId: values.branchId,
    offsite: values.offsite,
    address: values.offsite ? address : null,
    wishes: wishes || null,
    contact: contactOf(values),
    companyId: values.companyId,
  };
}
