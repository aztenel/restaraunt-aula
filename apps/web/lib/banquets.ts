/**
 * Банкеты и кейтеринг на витрине: заявка (POST /public/banquets/requests), смета по ссылке
 * с согласованием и счёт с онлайн-оплатой. Бюджет вводится в тенге и переводится в тиыны
 * строкой (parseFixed2) — без плавающей точки; все суммы сметы и счёта — от сервера.
 */
import { formatFixed2ForInput, parseFixed2, type ApiError } from '@aula/api-client';
import type { BanquetInvoice, BanquetRequestBody } from './api-types';
import { isSafePaymentUrl } from './payment-flow';
import { validateContact, type FieldError, type FormErrors } from './validation';

export const BANQUET_LIMITS = {
  guestsMin: 1,
  guestsMax: 5000,
  nameMax: 120,
  addressMax: 500,
  wishesMax: 4000,
  /** Бюджет не больше 1 млрд ₸ (защита от опечатки). */
  budgetMaxTiyn: 1_000_000_000_00,
} as const;

export type BanquetPlace = 'branch' | 'offsite';

export interface BanquetFormValues {
  eventType: string;
  /** YYYY-MM-DD */
  eventDate: string;
  /** HH:mm или '' */
  eventTime: string;
  guests: string;
  place: BanquetPlace;
  branchId: string;
  address: string;
  /** Бюджет в тенге, как ввёл гость ('' — не указан). */
  budget: string;
  name: string;
  phone: string;
  email: string;
  wishes: string;
  consentPersonalData: boolean;
  consentMarketing: boolean;
}

export function emptyBanquetForm(branchId = ''): BanquetFormValues {
  return {
    eventType: '',
    eventDate: '',
    eventTime: '',
    guests: '',
    place: 'branch',
    branchId,
    address: '',
    budget: '',
    name: '',
    phone: '',
    email: '',
    wishes: '',
    consentPersonalData: false,
    consentMarketing: false,
  };
}

export type BanquetField = keyof Omit<BanquetFormValues, 'consentMarketing'>;
export const BANQUET_FIELD_ORDER: readonly BanquetField[] = [
  'eventType',
  'eventDate',
  'eventTime',
  'guests',
  'place',
  'branchId',
  'address',
  'budget',
  'name',
  'phone',
  'email',
  'wishes',
  'consentPersonalData',
];

/** Бюджет в тенге → тиыны: null — не указан; 'invalid' — не число/отрицательный/больше 2 знаков после запятой. */
export function budgetToTiyn(input: string): number | null | 'invalid' {
  if (!input.trim()) return null;
  const parsed = parseFixed2(input, { max: BANQUET_LIMITS.budgetMaxTiyn });
  return parsed.ok ? parsed.value : 'invalid';
}

function guestsNumber(value: string): number | null {
  const text = value.trim();
  return /^\d{1,5}$/.test(text) ? Number(text) : null;
}

export function validateBanquetForm(values: BanquetFormValues, today: string): FormErrors<BanquetField> {
  const errors: FormErrors<BanquetField> = {};
  if (!values.eventType) errors.eventType = 'required';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.eventDate)) errors.eventDate = 'required';
  else if (values.eventDate < today) errors.eventDate = 'past';
  if (values.eventTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(values.eventTime)) errors.eventTime = 'invalid';
  const guests = guestsNumber(values.guests);
  if (!values.guests.trim()) errors.guests = 'required';
  else if (guests === null || guests < BANQUET_LIMITS.guestsMin || guests > BANQUET_LIMITS.guestsMax) errors.guests = 'range';
  if (values.place === 'branch' && !values.branchId) errors.branchId = 'required';
  if (values.place === 'offsite') {
    const address = values.address.trim();
    if (!address) errors.address = 'required';
    else if (address.length > BANQUET_LIMITS.addressMax) errors.address = 'tooLong';
  }
  if (budgetToTiyn(values.budget) === 'invalid') errors.budget = 'invalid';
  const contact = validateContact(values, { nameMax: BANQUET_LIMITS.nameMax });
  Object.assign(errors, contact as Partial<Record<BanquetField, FieldError>>);
  if (values.wishes.trim().length > BANQUET_LIMITS.wishesMax) errors.wishes = 'tooLong';
  if (!values.consentPersonalData) errors.consentPersonalData = 'consent';
  return errors;
}

export function toBanquetRequestBody(values: BanquetFormValues, locale: 'kk' | 'ru' | 'en'): BanquetRequestBody {
  const budget = budgetToTiyn(values.budget);
  const email = values.email.trim();
  const wishes = values.wishes.trim();
  return {
    eventDate: values.eventDate,
    ...(values.eventTime ? { eventTime: values.eventTime } : {}),
    eventType: values.eventType as BanquetRequestBody['eventType'],
    guests: guestsNumber(values.guests) ?? 0,
    ...(values.place === 'branch' ? { branchId: values.branchId } : { offsite: true, address: values.address.trim() }),
    ...(typeof budget === 'number' ? { budget: { amount: budget, currency: 'KZT' as const } } : {}),
    contact: { name: values.name.trim(), phone: values.phone.trim(), ...(email ? { email } : {}) },
    ...(wishes ? { wishes } : {}),
    consent: { personalData: values.consentPersonalData, ...(values.consentMarketing ? { marketing: true } : {}) },
    locale,
  };
}

/** Ошибка сервера → поле формы заявки. */
export function banquetFieldForError(error: Pick<ApiError, 'code'>): BanquetField | null {
  const map: Record<string, BanquetField> = {
    'banquet.invalid_event_type': 'eventType',
    'banquet.invalid_event_date': 'eventDate',
    'banquet.event_date_in_past': 'eventDate',
    'banquet.event_date_too_far': 'eventDate',
    'banquet.invalid_event_time': 'eventTime',
    'banquet.invalid_guests': 'guests',
    'banquet.branch_required': 'branchId',
    'banquet.unknown_branch': 'branchId',
    'banquet.offsite_address_required': 'address',
    'banquet.invalid_budget': 'budget',
    'banquet.contact_name_invalid': 'name',
    'banquet.contact_email_invalid': 'email',
    'phone.invalid': 'phone',
    'consent.required': 'consentPersonalData',
  };
  return map[error.code] ?? null;
}

/** Процент из базисных пунктов для подписи: 1000 → '10', 1250 → '12,5' (отображение, не расчёт). */
export function formatBasisPoints(bp: number, locale: string): string {
  return formatFixed2ForInput(bp, locale).replace(/([.,]\d)0$/, '$1');
}

// ---------------------------------------------------------------- Счёт

export type InvoicePhase = 'paid' | 'cancelled' | 'company' | 'payment_ready' | 'payment_needed';

export function invoicePhase(invoice: Pick<BanquetInvoice, 'status' | 'payerType' | 'paymentUrl' | 'paymentStatus'>): InvoicePhase {
  if (invoice.status === 'paid') return 'paid';
  if (invoice.status === 'cancelled') return 'cancelled';
  if (invoice.payerType === 'company') return 'company';
  const failed = invoice.paymentStatus === 'failed' || invoice.paymentStatus === 'cancelled';
  return invoice.paymentUrl && !failed && isSafePaymentUrl(invoice.paymentUrl) ? 'payment_ready' : 'payment_needed';
}

/**
 * Опрос счёта: пока ждём ссылку после «Оплатить» — часто; пока платёж создан/в обработке (гость
 * вернулся с оплаты) — раз в 5 с; иначе не опрашиваем. Итог оплаты подтверждает сервер.
 */
export function invoicePollDelay(
  invoice: Pick<BanquetInvoice, 'status' | 'payerType' | 'paymentUrl' | 'paymentStatus'>,
  input: { awaitingLink: boolean },
): number | null {
  if (invoice.status === 'paid' || invoice.status === 'cancelled' || invoice.payerType === 'company') return null;
  if (input.awaitingLink && !isSafePaymentUrl(invoice.paymentUrl)) return 1500;
  // succeeded при неоплаченном счёте — событие об оплате ещё обрабатывается.
  if (invoice.paymentStatus === 'created' || invoice.paymentStatus === 'pending' || invoice.paymentStatus === 'succeeded') return 5000;
  return null;
}

/** Куда перевести после «Оплатить» (одна попытка на ссылку): ссылка готова и платёж не завершён неудачей. */
export function invoicePaymentRedirect(
  invoice: Pick<BanquetInvoice, 'status' | 'payerType' | 'paymentUrl' | 'paymentStatus'>,
  input: { payNow: boolean; alreadyRedirected: boolean },
): string | null {
  if (!input.payNow || input.alreadyRedirected) return null;
  return invoicePhase(invoice) === 'payment_ready' ? invoice.paymentUrl : null;
}
