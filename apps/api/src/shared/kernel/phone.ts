import { ValidationError } from './errors';

/**
 * Телефон гостя нормализуется в формат +7XXXXXXXXXX (Казахстан/Россия, код +7).
 * Принимает 8 777 123 45 67, +7 (777) 123-45-67, 7771234567 и т.п.
 */
export type NormalizedPhone = string & { readonly __brand: 'NormalizedPhone' };

const NORMALIZED_RE = /^\+7\d{10}$/;

export function normalizePhone(raw: string): NormalizedPhone {
  const digits = (raw ?? '').replace(/\D/g, '');
  let national: string | null = null;
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    national = digits.slice(1);
  } else if (digits.length === 10) {
    national = digits;
  }
  if (!national || !/^[3-9]\d{9}$/.test(national)) {
    throw new ValidationError('phone.invalid', 'Phone must be a +7 number with 10 digits after the country code', {
      phone: raw,
    });
  }
  return `+7${national}` as NormalizedPhone;
}

export function isNormalizedPhone(value: string): value is NormalizedPhone {
  return NORMALIZED_RE.test(value);
}

export function tryNormalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (!raw) return null;
  try {
    return normalizePhone(raw);
  } catch {
    return null;
  }
}

/** Маска для логов и публичных ответов: +7 777 *** ** 67. */
export function maskPhone(phone: string): string {
  if (!isNormalizedPhone(phone)) return '***';
  return `+7 ${phone.slice(2, 5)} *** ** ${phone.slice(10, 12)}`;
}
