import { ValidationError } from '../../../shared/kernel/errors';
import { isIsoDate } from '../../../shared/kernel/time';

/**
 * Правила карточки гостя: нормализация полей, «не затираем данные менеджера», теги,
 * обезличивание. Чистые функции без доступа к БД.
 */
export const CUSTOMER_LIMITS = {
  name: 120,
  email: 254,
  allergies: 2000,
  preferences: 2000,
  notes: 5000,
  tag: 40,
  tagsPerCustomer: 30,
} as const;

/** Префикс необратимого маркера телефона обезличенного гостя. */
export const ANONYMIZED_PHONE_PREFIX = 'anon:';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

export function isValidEmail(value: string): boolean {
  return value.length <= CUSTOMER_LIMITS.email && EMAIL_RE.test(value);
}

/** Почта: обрезка пробелов, нижний регистр. Пустая строка -> null. Невалидная -> null (для данных из форм). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  return isValidEmail(value) ? value : null;
}

/** Почта из админки: невалидная — ошибка, а не молчаливый пропуск. */
export function requireValidEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  if (!isValidEmail(value)) throw new ValidationError('customer.email_invalid', 'Invalid email', { email: raw });
  return value;
}

/** Имя: обрезка и схлопывание пробелов, ограничение длины. Пустое -> null. */
export function normalizeName(raw: string | null | undefined): string | null {
  const value = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!value) return null;
  return value.slice(0, CUSTOMER_LIMITS.name);
}

/** Свободный текст (аллергии, предпочтения, заметки): обрезка, пустое -> null, длина ограничена. */
export function normalizeText(raw: string | null | undefined, field: 'allergies' | 'preferences' | 'notes'): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  if (value.length > CUSTOMER_LIMITS[field]) {
    throw new ValidationError('customer.text_too_long', `Field ${field} is too long`, { field, max: CUSTOMER_LIMITS[field] });
  }
  return value;
}

/** Тег: нижний регистр, пробелы -> дефис; буквы (в т.ч. кириллица), цифры, '_' и '-'. */
export function normalizeTag(raw: string): string {
  const value = (raw ?? '').trim().toLowerCase().replace(/\s+/g, '-');
  if (!value || value.length > CUSTOMER_LIMITS.tag || !TAG_RE.test(value)) {
    throw new ValidationError('customer.tag_invalid', 'Tag: letters, digits, "_" and "-", up to 40 characters', { tag: raw });
  }
  return value;
}

export function normalizeTags(raw: readonly string[]): string[] {
  const tags = [...new Set(raw.map(normalizeTag))];
  if (tags.length > CUSTOMER_LIMITS.tagsPerCustomer) {
    throw new ValidationError('customer.too_many_tags', `At most ${CUSTOMER_LIMITS.tagsPerCustomer} tags`, {
      max: CUSTOMER_LIMITS.tagsPerCustomer,
    });
  }
  return tags;
}

/** Добавить теги, которых ещё нет (порядок существующих сохраняется). */
export function mergeTags(current: readonly string[], added: readonly string[]): string[] {
  const result = [...current];
  for (const tag of added) {
    if (!result.includes(tag)) result.push(tag);
  }
  return result;
}

/** День рождения: YYYY-MM-DD, не в будущем и не раньше 1900 года. */
export function validateBirthday(value: string | null | undefined, today: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isIsoDate(value)) throw new ValidationError('customer.birthday_invalid', 'Birthday must be YYYY-MM-DD', { birthday: value });
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ValidationError('customer.birthday_invalid', 'Birthday is not a real date', { birthday: value });
  }
  if (y < 1900 || value > today) {
    throw new ValidationError('customer.birthday_invalid', 'Birthday is out of range', { birthday: value });
  }
  return value;
}

export interface IdentityFields {
  name: string | null;
  email: string | null;
}

/**
 * Данные из формы (заказ, бронь, заявка) дополняют карточку, но не затирают то,
 * что уже есть (например, ввёл менеджер): заполняются только пустые поля.
 */
export function fillEmptyFields(current: IdentityFields, incoming: { name?: string | null; email?: string | null }): Partial<IdentityFields> {
  const patch: Partial<IdentityFields> = {};
  const name = normalizeName(incoming.name);
  const email = normalizeEmail(incoming.email);
  if (!current.name && name) patch.name = name;
  if (!current.email && email) patch.email = email;
  return patch;
}

export function isAnonymizedPhone(phone: string): boolean {
  return phone.startsWith(ANONYMIZED_PHONE_PREFIX);
}

/** Маркер вместо телефона: 'anon:' + sha256 от случайного значения — восстановить номер невозможно. */
export function anonymizedPhoneMarker(sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) {
    throw new ValidationError('customer.anonymize_marker_invalid', 'Marker must be a sha256 hex digest');
  }
  return `${ANONYMIZED_PHONE_PREFIX}${sha256Hex}`;
}

/** Редактируемые менеджером поля карточки. */
export interface EditableProfile {
  name: string | null;
  email: string | null;
  birthday: string | null;
  locale: string;
  tags: string[];
  allergies: string | null;
  preferences: string | null;
  notes: string | null;
}

const PD_FIELDS = ['name', 'email', 'birthday', 'allergies', 'preferences', 'notes'] as const;

function maskValue(field: keyof EditableProfile, value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value);
  switch (field) {
    case 'name':
      return `${text.slice(0, 1)}***`;
    case 'email': {
      const [local, domain] = text.split('@');
      return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
    }
    case 'birthday':
      return '****-**-**';
    default:
      return `[${text.length} симв.]`;
  }
}

/**
 * Запись в журнал действий об изменении карточки: только изменённые поля.
 * Персональные данные в журнале маскируются: журнал только на добавление, и полные ПД в нём
 * сделали бы невозможным обезличивание гостя по его требованию. Теги и язык пишутся как есть.
 */
export function describeProfileChange(
  before: EditableProfile,
  after: EditableProfile,
): { changed: Array<keyof EditableProfile>; before: Record<string, unknown>; after: Record<string, unknown> } {
  const changed: Array<keyof EditableProfile> = [];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const field of Object.keys(after) as Array<keyof EditableProfile>) {
    const same = JSON.stringify(before[field]) === JSON.stringify(after[field]);
    if (same) continue;
    changed.push(field);
    const isPd = (PD_FIELDS as readonly string[]).includes(field);
    b[field] = isPd ? maskValue(field, before[field]) : before[field];
    a[field] = isPd ? maskValue(field, after[field]) : after[field];
  }
  return { changed, before: b, after: a };
}
