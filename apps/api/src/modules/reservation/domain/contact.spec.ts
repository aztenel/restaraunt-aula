import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { guestContact, normalizeFreeText, normalizeGuestEmail, normalizeGuestName } from './contact';

describe('guest contact', () => {
  it('normalizes phone, name and email', () => {
    expect(guestContact({ name: '  Айгерим   Н. ', phone: '8 (701) 123-45-67', email: ' A@Mail.KZ ' }, { nameRequired: true })).toEqual({
      id: null,
      phone: '+77011234567',
      name: 'Айгерим Н.',
      email: 'a@mail.kz',
    });
  });

  it('validates required name, email format, phone', () => {
    expect(() => normalizeGuestName('  ', { required: true })).toThrow(expect.objectContaining({ code: 'reservation.name_required' }));
    expect(normalizeGuestName('', { required: false })).toBeNull();
    expect(() => normalizeGuestName('x'.repeat(101), { required: true })).toThrow(ValidationError);
    expect(() => normalizeGuestEmail('broken@')).toThrow(expect.objectContaining({ code: 'reservation.email_invalid' }));
    expect(normalizeGuestEmail(null)).toBeNull();
    expect(() => guestContact({ name: 'A', phone: '123' }, { nameRequired: true })).toThrow(expect.objectContaining({ code: 'phone.invalid' }));
  });

  it('free text is trimmed and limited', () => {
    expect(normalizeFreeText('  у окна ', 'comment')).toBe('у окна');
    expect(normalizeFreeText('   ', 'comment')).toBeNull();
    expect(() => normalizeFreeText('x'.repeat(1001), 'comment')).toThrow(ValidationError);
  });
});
