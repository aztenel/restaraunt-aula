import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import {
  anonymizedPhoneMarker,
  describeProfileChange,
  EditableProfile,
  fillEmptyFields,
  isAnonymizedPhone,
  mergeTags,
  normalizeEmail,
  normalizeName,
  normalizeTag,
  normalizeTags,
  normalizeText,
  requireValidEmail,
  validateBirthday,
} from './customer';

describe('customer: normalization', () => {
  it('normalizes email and drops invalid values from forms', () => {
    expect(normalizeEmail('  Guest@Mail.KZ ')).toBe('guest@mail.kz');
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('not-an-email')).toBeNull();
  });

  it('rejects invalid email entered by staff', () => {
    expect(requireValidEmail(' A@B.kz ')).toBe('a@b.kz');
    expect(requireValidEmail('')).toBeNull();
    expect(() => requireValidEmail('broken@')).toThrow(ValidationError);
  });

  it('normalizes names and texts', () => {
    expect(normalizeName('  Айгерим   Нурланқызы ')).toBe('Айгерим Нурланқызы');
    expect(normalizeName('   ')).toBeNull();
    expect(normalizeName('x'.repeat(200))).toHaveLength(120);
    expect(normalizeText('  орехи ', 'allergies')).toBe('орехи');
    expect(normalizeText('', 'notes')).toBeNull();
    expect(() => normalizeText('x'.repeat(2001), 'allergies')).toThrow(/too long/);
  });

  it('normalizes tags: lower case, spaces to dashes, unicode letters allowed', () => {
    expect(normalizeTag(' VIP ')).toBe('vip');
    expect(normalizeTag('Постоянный гость')).toBe('постоянный-гость');
    expect(() => normalizeTag('')).toThrow(ValidationError);
    expect(() => normalizeTag('bad!tag')).toThrow(ValidationError);
    expect(() => normalizeTag('x'.repeat(41))).toThrow(ValidationError);
    expect(normalizeTags(['vip', 'VIP', 'corporate'])).toEqual(['vip', 'corporate']);
    expect(() => normalizeTags(Array.from({ length: 31 }, (_, i) => `t${i}`))).toThrow(/At most/);
    expect(mergeTags(['vip'], ['regular', 'vip'])).toEqual(['vip', 'regular']);
  });

  it('validates birthday', () => {
    expect(validateBirthday('1990-05-17', '2026-10-01')).toBe('1990-05-17');
    expect(validateBirthday(null, '2026-10-01')).toBeNull();
    expect(() => validateBirthday('1990-02-30', '2026-10-01')).toThrow(ValidationError);
    expect(() => validateBirthday('2027-01-01', '2026-10-01')).toThrow(ValidationError);
    expect(() => validateBirthday('1899-12-31', '2026-10-01')).toThrow(ValidationError);
    expect(() => validateBirthday('17.05.1990', '2026-10-01')).toThrow(ValidationError);
  });
});

describe('customer: data from forms never overwrites existing data', () => {
  it('fills only empty fields', () => {
    expect(fillEmptyFields({ name: null, email: null }, { name: ' Асель ', email: 'A@b.kz' })).toEqual({ name: 'Асель', email: 'a@b.kz' });
    expect(fillEmptyFields({ name: 'Асель (менеджер)', email: 'm@b.kz' }, { name: 'Другое', email: 'x@y.kz' })).toEqual({});
    expect(fillEmptyFields({ name: 'Асель', email: null }, { name: 'Другое', email: 'bad' })).toEqual({});
  });
});

describe('customer: anonymization', () => {
  it('builds an irreversible marker', () => {
    const marker = anonymizedPhoneMarker('a'.repeat(64));
    expect(marker).toBe(`anon:${'a'.repeat(64)}`);
    expect(isAnonymizedPhone(marker)).toBe(true);
    expect(isAnonymizedPhone('+77011234567')).toBe(false);
    expect(() => anonymizedPhoneMarker('+77011234567')).toThrow(ValidationError);
  });
});

describe('customer: audit of profile changes masks personal data', () => {
  const before: EditableProfile = {
    name: 'Айгерим',
    email: 'aigerim@mail.kz',
    birthday: '1990-05-17',
    locale: 'ru',
    tags: ['vip'],
    allergies: null,
    preferences: 'у окна',
    notes: null,
  };

  it('records only changed fields; PD masked, tags as is', () => {
    const after: EditableProfile = { ...before, name: 'Айгерим Н.', tags: ['vip', 'corporate'], allergies: 'орехи', locale: 'kk' };
    const change = describeProfileChange(before, after);
    expect(change.changed.sort()).toEqual(['allergies', 'locale', 'name', 'tags']);
    expect(change.before).toEqual({ name: 'А***', locale: 'ru', tags: ['vip'], allergies: null });
    expect(change.after).toEqual({ name: 'А***', locale: 'kk', tags: ['vip', 'corporate'], allergies: '[5 симв.]' });
    expect(JSON.stringify(change)).not.toContain('Айгерим');
  });

  it('masks email and birthday', () => {
    const change = describeProfileChange(before, { ...before, email: 'new@mail.kz', birthday: '1991-01-01' });
    expect(change.before).toEqual({ email: 'a***@mail.kz', birthday: '****-**-**' });
    expect(change.after).toEqual({ email: 'n***@mail.kz', birthday: '****-**-**' });
  });
});
