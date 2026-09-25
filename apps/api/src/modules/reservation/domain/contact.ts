import { ValidationError } from '../../../shared/kernel/errors';
import { normalizePhone } from '../../../shared/kernel/phone';
import { ReservationCustomer } from './reservation';

/**
 * Контакт гостя в брони: телефон нормализуется в +7XXXXXXXXXX (гость идентифицируется по телефону),
 * имя обязательно, почта — по желанию. Комментарий и повод — короткий свободный текст.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_NAME_LENGTH = 100;
export const MAX_COMMENT_LENGTH = 1000;

export function normalizeGuestName(name: string | null | undefined, options: { required: boolean }): string | null {
  const value = (name ?? '').trim().replace(/\s+/g, ' ');
  if (!value) {
    if (options.required) throw new ValidationError('reservation.name_required', 'Guest name is required');
    return null;
  }
  if (value.length > MAX_NAME_LENGTH) {
    throw new ValidationError('reservation.name_too_long', `Guest name must be up to ${MAX_NAME_LENGTH} characters`);
  }
  return value;
}

export function normalizeGuestEmail(email: string | null | undefined): string | null {
  const value = (email ?? '').trim().toLowerCase();
  if (!value) return null;
  if (!EMAIL_RE.test(value) || value.length > 200) throw new ValidationError('reservation.email_invalid', 'Invalid email', { email });
  return value;
}

export function normalizeFreeText(text: string | null | undefined, field: string, max = MAX_COMMENT_LENGTH): string | null {
  const value = (text ?? '').trim();
  if (!value) return null;
  if (value.length > max) throw new ValidationError('reservation.text_too_long', `${field} must be up to ${max} characters`, { field, max });
  return value;
}

/** Контакт гостя из формы (customerId заполняется после идентификации в базе гостей). */
export function guestContact(input: { name?: string | null; phone: string; email?: string | null }, options: { nameRequired: boolean }): ReservationCustomer {
  return {
    id: null,
    phone: normalizePhone(input.phone),
    name: normalizeGuestName(input.name, { required: options.nameRequired }),
    email: normalizeGuestEmail(input.email),
  };
}
