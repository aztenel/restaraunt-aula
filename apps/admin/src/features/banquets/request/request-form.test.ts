import { describe, expect, it } from 'vitest';
import { emptyRequestForm, looksLikePhone, toCreateInput, toUpdateInput, validateRequestForm, type RequestFormValues } from './request-form';

const filled: RequestFormValues = {
  ...emptyRequestForm({ branchId: 'b1' }),
  eventDate: '2026-11-14',
  eventTime: '18:00',
  eventType: 'wedding',
  guests: 120,
  budget: 500_000_000,
  contactName: ' Айгерим ',
  contactPhone: '+7 701 123 45 67',
  contactEmail: '',
  wishes: ' Живая музыка ',
  consentPersonalData: true,
};

describe('заявка из админки', () => {
  it('корректная форма → тело POST /requests', () => {
    expect(validateRequestForm(filled, { today: '2026-10-01' })).toEqual([]);
    expect(toCreateInput(filled)).toEqual({
      eventDate: '2026-11-14',
      eventTime: '18:00',
      eventType: 'wedding',
      guests: 120,
      branchId: 'b1',
      budget: { amount: 500_000_000, currency: 'KZT' },
      contact: { name: 'Айгерим', phone: '+7 701 123 45 67' },
      wishes: 'Живая музыка',
      consent: { personalData: true, marketing: false },
      locale: 'ru',
    });
  });

  it('выезд: нужен адрес, филиал-исполнитель необязателен', () => {
    const offsite = { ...filled, offsite: true, branchId: null, address: '' };
    expect(validateRequestForm(offsite, { today: '2026-10-01' })).toEqual(['addressRequired']);
    const input = toCreateInput({ ...offsite, address: ' г. Астана, ул. Кенесары 1 ' });
    expect(input).toMatchObject({ offsite: true, address: 'г. Астана, ул. Кенесары 1' });
    expect(input).not.toHaveProperty('branchId');
  });

  it('обязательные поля и ограничения', () => {
    const empty = emptyRequestForm({ branchId: null });
    expect(validateRequestForm(empty, { today: '2026-10-01' })).toEqual([
      'eventDateRequired',
      'eventTypeRequired',
      'guestsInvalid',
      'branchRequired',
      'contactNameRequired',
      'contactPhoneInvalid',
    ]);
    expect(validateRequestForm({ ...filled, guests: 5001, contactEmail: 'нет', eventDate: '2026-09-30' }, { today: '2026-10-01' })).toEqual([
      'eventDateInPast',
      'guestsInvalid',
      'contactEmailInvalid',
    ]);
    expect(validateRequestForm({ ...filled, eventDate: '2028-10-02' }, { today: '2026-10-01' })).toEqual(['eventDateTooFar']);
  });

  it('при правке прошедшая дата допустима, если её не меняли', () => {
    expect(validateRequestForm({ ...filled, eventDate: '2026-09-20' }, { today: '2026-10-01', originalEventDate: '2026-09-20' })).toEqual([]);
  });

  it('PATCH: nullable-поля очищаются явно', () => {
    expect(toUpdateInput({ ...filled, eventTime: null, budget: null, wishes: '  ', companyId: null })).toEqual({
      eventDate: '2026-11-14',
      eventTime: null,
      eventType: 'wedding',
      guests: 120,
      budget: null,
      branchId: 'b1',
      offsite: false,
      address: null,
      wishes: null,
      contact: { name: 'Айгерим', phone: '+7 701 123 45 67' },
      companyId: null,
    });
  });

  it('телефон — 10–15 цифр', () => {
    expect(looksLikePhone('+7 (701) 123-45-67')).toBe(true);
    expect(looksLikePhone('87011234567')).toBe(true);
    expect(looksLikePhone('12345')).toBe(false);
  });
});
