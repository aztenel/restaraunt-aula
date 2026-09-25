import { describe, expect, it } from 'vitest';
import { newIdempotencyKey, phoneLooksValid, toCreatePayload, toReschedulePayload, validateBooking, type BookingFormValues } from './booking-form';

const base: BookingFormValues = {
  date: '2026-10-25',
  time: '19:30',
  guests: 4,
  venueId: 'v1',
  phone: '+7 701 123 45 67',
  name: ' Айгерим ',
  locale: 'kk',
};
const ctx = { branchId: 'b1', venueHasDeposit: false, canWaiveDeposit: true, idempotencyKey: 'adm-key-123' };

describe('бронь оператором: проверка и тело запроса', () => {
  it('минимальная бронь без депозита', () => {
    expect(validateBooking(base, ctx)).toEqual({});
    expect(toCreatePayload(base, ctx)).toEqual({
      branchId: 'b1',
      venueId: 'v1',
      date: '2026-10-25',
      time: '19:30',
      guests: 4,
      customer: { phone: '+7 701 123 45 67', name: 'Айгерим' },
      locale: 'kk',
      idempotencyKey: 'adm-key-123',
    });
  });

  it('пустые поля не отправляются; длительность — только если задана', () => {
    const payload = toCreatePayload({ ...base, comment: '  ', note: 'VIP', durationMinutes: 180, email: '' }, ctx);
    expect(payload).toMatchObject({ note: 'VIP', durationMinutes: 180 });
    expect(payload).not.toHaveProperty('comment');
    expect(payload.customer).not.toHaveProperty('email');
  });

  it('обязательные поля', () => {
    expect(validateBooking({ phone: '' }, ctx)).toEqual({
      date: 'date_required',
      time: 'time_required',
      guests: 'guests_required',
      venueId: 'venue_required',
      phone: 'phone_required',
    });
    expect(validateBooking({ ...base, phone: '12345' }, ctx).phone).toBe('phone_invalid');
    expect(phoneLooksValid('8 (701) 123-45-67')).toBe(true);
    expect(phoneLooksValid('7011234567')).toBe(true);
  });

  it('место с депозитом: нужно решение — ссылка на оплату или отказ с причиной', () => {
    const deposit = { ...ctx, venueHasDeposit: true };
    expect(validateBooking(base, deposit)).toEqual({ depositMode: 'deposit_decision_required' });
    expect(toCreatePayload({ ...base, depositMode: 'payment_link' }, deposit).deposit).toEqual({ mode: 'payment_link' });
    expect(validateBooking({ ...base, depositMode: 'waive', waiveReason: ' ' }, deposit)).toEqual({ waiveReason: 'waive_reason_required' });
    expect(toCreatePayload({ ...base, depositMode: 'waive', waiveReason: ' Постоянный гость ' }, deposit).deposit).toEqual({
      mode: 'waive',
      waiveReason: 'Постоянный гость',
    });
  });

  it('отказ от депозита без права — ошибка до отправки', () => {
    expect(validateBooking({ ...base, depositMode: 'waive', waiveReason: 'x' }, { venueHasDeposit: true, canWaiveDeposit: false })).toEqual({
      depositMode: 'waive_not_allowed',
    });
  });

  it('решение по депозиту не отправляется для места без депозита', () => {
    expect(toCreatePayload({ ...base, depositMode: 'waive', waiveReason: 'x' }, ctx)).not.toHaveProperty('deposit');
  });

  it('согласия гостя, полученные по телефону', () => {
    expect(toCreatePayload({ ...base, consentPersonalData: true }, ctx).consent).toEqual({ personalData: true });
    expect(toCreatePayload(base, ctx)).not.toHaveProperty('consent');
  });

  it('ключ идемпотентности — уникальный на попытку', () => {
    const a = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(newIdempotencyKey()).not.toBe(a);
  });
});

describe('перенос: только изменённые поля', () => {
  const current = { venueId: 'v1', date: '2026-10-25', time: '19:00', durationMinutes: 120, guests: 4 };

  it('ничего не изменилось — запроса нет', () => {
    expect(toReschedulePayload({ ...current, reason: 'x' }, current)).toBeNull();
  });

  it('пересадка на другое место и новое время', () => {
    expect(toReschedulePayload({ ...current, venueId: 'v2', time: '20:00', reason: ' Гость попросил ' }, current)).toEqual({
      venueId: 'v2',
      time: '20:00',
      reason: 'Гость попросил',
    });
  });

  it('гости и длительность', () => {
    expect(toReschedulePayload({ ...current, guests: 6, durationMinutes: 180 }, current)).toEqual({ guests: 6, durationMinutes: 180 });
  });
});
