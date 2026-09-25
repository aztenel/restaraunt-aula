import { describe, expect, it } from 'vitest';
import type { Reservation, VenueSlot } from '@/lib/api-types';
import {
  addDays,
  availabilityQuery,
  bookingErrorTarget,
  canBook,
  defaultSearch,
  EMPTY_CONTACT,
  localDate,
  reservationPaymentRedirect,
  reservationPhase,
  reservationPollDelay,
  timeOptions,
  toBookingBody,
  validateBookingContact,
  validateSearch,
  venueTypes,
  type BookingSearch,
} from '@/lib/booking';

const search: BookingSearch = { branchSlug: 'greenline', date: '2026-10-10', time: '19:00', guests: 4, typeCode: '' };

const venue = (patch: Partial<VenueSlot> = {}): VenueSlot =>
  ({
    venueId: 'v-yurt',
    hallId: 'h1',
    hallName: 'Двор',
    name: 'Юрта «Алтын»',
    description: '',
    typeCode: 'yurt',
    typeName: 'Юрта',
    capacityMin: 4,
    capacityMax: 12,
    deposit: { amount: 2_000_000, currency: 'KZT' },
    start: '2026-10-10T14:00:00Z',
    end: '2026-10-10T17:00:00Z',
    durationMinutes: 180,
    rules: { holdMinutes: 30, cancellationDeadlineHours: 24, requiresManualConfirmation: false },
    position: { x: 0, y: 0, w: 10, h: 10, shape: 'circle', rotation: 0 },
    photos: [],
    ...patch,
  }) as VenueSlot;

describe('бронь: поиск', () => {
  it('даты и время — в часовом поясе филиала', () => {
    // 20:30 UTC = 01:30 следующего дня в Астане (UTC+5).
    expect(localDate(new Date('2026-09-25T20:30:00Z'))).toBe('2026-09-26');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(timeOptions(60, '10:00', '12:00')).toEqual(['10:00', '11:00', '12:00']);
  });

  it('по умолчанию — сегодня в 19:00, вечером — завтра', () => {
    expect(defaultSearch('greenline', new Date('2026-09-25T05:00:00Z'))).toMatchObject({ date: '2026-09-25', time: '19:00', guests: 2 });
    expect(defaultSearch('greenline', new Date('2026-09-25T14:00:00Z')).date).toBe('2026-09-26');
  });

  it('проверка формы поиска', () => {
    expect(validateSearch(search, '2026-10-01')).toEqual({});
    expect(validateSearch({ ...search, date: '2026-09-30' }, '2026-10-01')).toEqual({ date: 'past' });
    expect(validateSearch({ ...search, branchSlug: '', time: '25:00', guests: 0 }, '2026-10-01')).toEqual({ branchSlug: 'required', time: 'required', guests: 'range' });
  });

  it('запрос свободных мест: тип места — только если выбран', () => {
    expect(availabilityQuery(search, 'kk')).toEqual({ date: '2026-10-10', time: '19:00', guests: 4, locale: 'kk' });
    expect(availabilityQuery({ ...search, typeCode: 'vip_hall' }, 'ru')).toMatchObject({ typeCode: 'vip_hall' });
  });

  it('типы мест для фильтра — без повторов', () => {
    expect(venueTypes([venue(), venue({ venueId: 'v2' }), venue({ typeCode: 'vip_hall', typeName: 'VIP-зал' })])).toEqual([
      { code: 'yurt', name: 'Юрта' },
      { code: 'vip_hall', name: 'VIP-зал' },
    ]);
  });
});

describe('бронь: выбор места → тело запроса', () => {
  const contact = { ...EMPTY_CONTACT, name: ' Айгерим ', phone: '+7 701 123 45 67', occasion: ' День рождения ', consentPersonalData: true };

  it('контакты и согласие обязательны', () => {
    expect(validateBookingContact(EMPTY_CONTACT)).toEqual({ name: 'required', phone: 'required', consentPersonalData: 'consent' });
    expect(validateBookingContact({ ...contact, email: 'not-an-email' })).toEqual({ email: 'email' });
    expect(canBook(null, contact)).toBe(false);
    expect(canBook(venue(), contact)).toBe(true);
  });

  it('тело POST /public/reservations: выбранное место, слот, контакты, ключ идемпотентности', () => {
    const body = toBookingBody({
      branchId: 'b1',
      venue: venue(),
      search,
      contact,
      locale: 'ru',
      idempotencyKey: 'key-1',
      phoneVerificationToken: null,
    });
    expect(body).toEqual({
      branchId: 'b1',
      venueId: 'v-yurt',
      date: '2026-10-10',
      time: '19:00',
      guests: 4,
      durationMinutes: 180,
      customer: { name: 'Айгерим', phone: '+7 701 123 45 67' },
      occasion: 'День рождения',
      consent: { personalData: true },
      locale: 'ru',
      idempotencyKey: 'key-1',
    });
  });

  it('подтверждённый телефон и маркетинговое согласие попадают в запрос', () => {
    const body = toBookingBody({
      branchId: 'b1',
      venue: venue({ deposit: null }),
      search,
      contact: { ...contact, email: 'a@mail.kz', comment: 'У окна', consentMarketing: true },
      locale: 'kk',
      idempotencyKey: 'key-2',
      phoneVerificationToken: 'vt',
    });
    expect(body).toMatchObject({ customer: { email: 'a@mail.kz' }, comment: 'У окна', phoneVerificationToken: 'vt', consent: { personalData: true, marketing: true } });
  });

  it('ошибки сервера: подтверждение телефона, поле, обновление выдачи', () => {
    expect(bookingErrorTarget({ code: 'phone.not_verified' })).toEqual({ field: null, needsVerification: true, refresh: false });
    expect(bookingErrorTarget({ code: 'phone.invalid' }).field).toBe('phone');
    expect(bookingErrorTarget({ code: 'consent.required' }).field).toBe('consentPersonalData');
    expect(bookingErrorTarget({ code: 'reservation.venue_occupied' }).refresh).toBe(true);
    expect(bookingErrorTarget({ code: 'reservation.capacity_exceeded' }).refresh).toBe(true);
    expect(bookingErrorTarget({ code: 'unknown' })).toEqual({ field: null, needsVerification: false, refresh: false });
  });
});

describe('бронь: страница брони', () => {
  type R = Pick<Reservation, 'status' | 'deposit' | 'canPay'>;
  const deposit = (paymentStatus: string | null, paymentUrl: string | null) => ({
    amount: { amount: 2_000_000, currency: 'KZT' as const },
    state: 'pending' as const,
    outcome: 'none' as const,
    paymentStatus,
    paymentUrl,
  });
  const r = (status: Reservation['status'], dep: R['deposit'] = null): R => ({ status, deposit: dep, canPay: status === 'awaiting_deposit' });

  it('этапы по статусу брони и платежу депозита', () => {
    expect(reservationPhase(r('awaiting_deposit', deposit(null, null)))).toBe('deposit_preparing');
    expect(reservationPhase(r('awaiting_deposit', deposit('pending', 'https://pay.example/d1')))).toBe('deposit_awaiting');
    expect(reservationPhase(r('awaiting_deposit', deposit('failed', 'https://pay.example/d1')))).toBe('deposit_failed');
    expect(reservationPhase(r('pending'))).toBe('pending');
    expect(reservationPhase(r('confirmed'))).toBe('confirmed');
    expect(reservationPhase(r('cancelled'))).toBe('cancelled');
    expect(reservationPhase(r('expired'))).toBe('expired');
  });

  it('опрос: пока готовится ссылка, ждём оплату или подтверждение', () => {
    expect(reservationPollDelay(r('awaiting_deposit', deposit(null, null)))).toBe(1500);
    expect(reservationPollDelay(r('awaiting_deposit', deposit('pending', 'https://pay.example/d1')))).toBe(4000);
    expect(reservationPollDelay(r('pending'))).toBe(15_000);
    expect(reservationPollDelay(r('awaiting_deposit', deposit('failed', null)))).toBeNull();
    expect(reservationPollDelay(r('confirmed'))).toBeNull();
  });

  it('переход на оплату депозита — один раз, сразу после брони', () => {
    const ready = r('awaiting_deposit', deposit('pending', 'https://pay.example/d1'));
    expect(reservationPaymentRedirect(ready, { autoPay: true, alreadyRedirected: false })).toBe('https://pay.example/d1');
    expect(reservationPaymentRedirect(ready, { autoPay: true, alreadyRedirected: true })).toBeNull();
    expect(reservationPaymentRedirect(ready, { autoPay: false, alreadyRedirected: false })).toBeNull();
    expect(reservationPaymentRedirect(r('confirmed'), { autoPay: true, alreadyRedirected: false })).toBeNull();
  });
});
