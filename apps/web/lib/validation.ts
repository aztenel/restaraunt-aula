/**
 * Проверки полей форм — только удобство (обязательность, формат). Правила домена (телефон +7,
 * вместимость, сроки) окончательно проверяет сервер; его ошибки сопоставляются полям.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmailLike(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

/** Похоже на телефон: 10–11 цифр (формат +7 проверит сервер — phone.invalid). */
export function isPhoneLike(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 11;
}

/** Телефон для сравнения (+7XXXXXXXXXX из 8XXX…, 7XXX…, XXX…): только чтобы понять, что номер сменился. */
export function comparablePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return digits;
}

export type FieldError = 'required' | 'tooShort' | 'tooLong' | 'email' | 'phone' | 'consent' | 'invalid' | 'past' | 'range';
export type FormErrors<F extends string> = Partial<Record<F, FieldError>>;

/** Первое поле с ошибкой в порядке формы (для фокуса). */
export function firstError<F extends string>(errors: FormErrors<F>, order: readonly F[]): F | null {
  return order.find((field) => errors[field] !== undefined) ?? null;
}

export function hasErrors<F extends string>(errors: FormErrors<F>): boolean {
  return Object.values(errors).some(Boolean);
}

/** Контакты гостя (заказ, бронь, банкет). */
export interface ContactValues {
  name: string;
  phone: string;
  email: string;
}

export function validateContact(values: ContactValues, limits: { nameMax: number; emailRequired?: boolean }): FormErrors<'name' | 'phone' | 'email'> {
  const errors: FormErrors<'name' | 'phone' | 'email'> = {};
  const name = values.name.trim();
  if (!name) errors.name = 'required';
  else if (name.length > limits.nameMax) errors.name = 'tooLong';
  if (!values.phone.trim()) errors.phone = 'required';
  else if (values.phone.length > 32 || !isPhoneLike(values.phone)) errors.phone = 'phone';
  const email = values.email.trim();
  if (!email) {
    if (limits.emailRequired) errors.email = 'required';
  } else if (email.length > 200 || !isEmailLike(email)) errors.email = 'email';
  return errors;
}
