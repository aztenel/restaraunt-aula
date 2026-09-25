import { describe, expect, it } from 'vitest';
import {
  banquetFieldForError,
  budgetToTiyn,
  emptyBanquetForm,
  formatBasisPoints,
  invoicePaymentRedirect,
  invoicePhase,
  invoicePollDelay,
  toBanquetRequestBody,
  validateBanquetForm,
  type BanquetFormValues,
} from '@/lib/banquets';

const filled = (patch: Partial<BanquetFormValues> = {}): BanquetFormValues => ({
  ...emptyBanquetForm('b1'),
  eventType: 'kudalyk',
  eventDate: '2026-11-14',
  eventTime: '18:00',
  guests: '80',
  budget: '1 500 000',
  name: ' Айгерим ',
  phone: '+7 701 123 45 67',
  consentPersonalData: true,
  ...patch,
});

describe('банкет: бюджет тенге → тиыны', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['500000', 50_000_000],
    ['1 500 000', 150_000_000],
    ['1500000,50', 150_000_050],
    ['0.1', 10],
    ['0.29', 29],
    ['12.345', 'invalid'],
    ['-5', 'invalid'],
    ['пятьсот', 'invalid'],
    ['1000000001', 'invalid'],
  ])('%j → %j', (input, expected) => {
    expect(budgetToTiyn(input)).toBe(expected);
  });
});

describe('банкет: заявка', () => {
  it('обязательные поля и согласие', () => {
    expect(validateBanquetForm(emptyBanquetForm(''), '2026-10-01')).toMatchObject({
      eventType: 'required',
      eventDate: 'required',
      guests: 'required',
      branchId: 'required',
      name: 'required',
      phone: 'required',
      consentPersonalData: 'consent',
    });
    expect(validateBanquetForm(filled(), '2026-10-01')).toEqual({});
  });

  it('прошедшая дата, гости вне диапазона, неверный бюджет, выезд без адреса', () => {
    expect(validateBanquetForm(filled({ eventDate: '2026-09-30' }), '2026-10-01')).toEqual({ eventDate: 'past' });
    expect(validateBanquetForm(filled({ guests: '0' }), '2026-10-01')).toEqual({ guests: 'range' });
    expect(validateBanquetForm(filled({ guests: '5001' }), '2026-10-01')).toEqual({ guests: 'range' });
    expect(validateBanquetForm(filled({ budget: '12,345' }), '2026-10-01')).toEqual({ budget: 'invalid' });
    expect(validateBanquetForm(filled({ place: 'offsite', address: ' ' }), '2026-10-01')).toEqual({ address: 'required' });
  });

  it('в ресторане: филиал, бюджет в тиынах, без пустых полей', () => {
    expect(toBanquetRequestBody(filled(), 'ru')).toEqual({
      eventDate: '2026-11-14',
      eventTime: '18:00',
      eventType: 'kudalyk',
      guests: 80,
      branchId: 'b1',
      budget: { amount: 150_000_000, currency: 'KZT' },
      contact: { name: 'Айгерим', phone: '+7 701 123 45 67' },
      consent: { personalData: true },
      locale: 'ru',
    });
  });

  it('выезд: адрес вместо филиала, бюджет не указан', () => {
    const body = toBanquetRequestBody(
      filled({ place: 'offsite', address: ' Коттеджный городок, 7 ', budget: '', eventTime: '', email: 'a@mail.kz', wishes: ' Живая музыка ', consentMarketing: true }),
      'kk',
    );
    expect(body).toMatchObject({ offsite: true, address: 'Коттеджный городок, 7', contact: { email: 'a@mail.kz' }, wishes: 'Живая музыка', consent: { personalData: true, marketing: true }, locale: 'kk' });
    expect(body).not.toHaveProperty('branchId');
    expect(body).not.toHaveProperty('budget');
    expect(body).not.toHaveProperty('eventTime');
  });

  it('ошибки сервера → поля формы', () => {
    expect(banquetFieldForError({ code: 'banquet.event_date_in_past' })).toBe('eventDate');
    expect(banquetFieldForError({ code: 'banquet.offsite_address_required' })).toBe('address');
    expect(banquetFieldForError({ code: 'banquet.unknown_branch' })).toBe('branchId');
    expect(banquetFieldForError({ code: 'phone.invalid' })).toBe('phone');
    expect(banquetFieldForError({ code: 'banquet.no_manager' })).toBeNull();
  });

  it('проценты из базисных пунктов — только подпись', () => {
    expect(formatBasisPoints(1000, 'ru')).toBe('10');
    expect(formatBasisPoints(1250, 'ru')).toBe('12,5');
    expect(formatBasisPoints(1200, 'en')).toBe('12');
  });
});

describe('банкет: счёт', () => {
  const invoice = (patch: Partial<Parameters<typeof invoicePhase>[0]> = {}) => ({
    status: 'issued' as const,
    payerType: 'individual' as const,
    paymentUrl: null as string | null,
    paymentStatus: null as string | null,
    ...patch,
  });

  it('этапы: юрлицо, оплачен, отменён, ссылка готова, нужна новая ссылка', () => {
    expect(invoicePhase(invoice({ payerType: 'company' }))).toBe('company');
    expect(invoicePhase(invoice({ status: 'paid' }))).toBe('paid');
    expect(invoicePhase(invoice({ status: 'cancelled' }))).toBe('cancelled');
    expect(invoicePhase(invoice({ paymentUrl: 'https://pay.example/i1', paymentStatus: 'pending' }))).toBe('payment_ready');
    expect(invoicePhase(invoice({ paymentUrl: 'https://pay.example/i1', paymentStatus: 'failed' }))).toBe('payment_needed');
    expect(invoicePhase(invoice())).toBe('payment_needed');
  });

  it('после «Оплатить» ждём ссылку и переходим один раз', () => {
    expect(invoicePollDelay(invoice(), { awaitingLink: true })).toBe(1500);
    expect(invoicePollDelay(invoice(), { awaitingLink: false })).toBeNull();
    expect(invoicePollDelay(invoice({ paymentUrl: 'https://pay.example/i1', paymentStatus: 'pending' }), { awaitingLink: false })).toBe(5000);
    expect(invoicePollDelay(invoice({ status: 'paid' }), { awaitingLink: true })).toBeNull();
    const ready = invoice({ paymentUrl: 'https://pay.example/i1', paymentStatus: 'pending' });
    expect(invoicePaymentRedirect(ready, { payNow: true, alreadyRedirected: false })).toBe('https://pay.example/i1');
    expect(invoicePaymentRedirect(ready, { payNow: false, alreadyRedirected: false })).toBeNull();
    expect(invoicePaymentRedirect(ready, { payNow: true, alreadyRedirected: true })).toBeNull();
  });
});
