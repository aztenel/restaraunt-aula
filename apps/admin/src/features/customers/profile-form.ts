/**
 * Карточка гостя (customers.manage): профиль, теги, аллергии, предпочтения, заметки ⇄ UpdateCustomerDto.
 * Ограничения — зеркало CUSTOMER_LIMITS и normalizeTag на сервере.
 */
import type { Dayjs } from 'dayjs';
import { dayjs } from '@/shared/lib/dates';
import type { Customer, UpdateCustomerBody } from './types';

export const PROFILE_LIMITS = { name: 120, email: 254, allergies: 2000, preferences: 2000, notes: 5000, tag: 40, tags: 30 } as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TAG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

export interface ProfileFormValues {
  name: string;
  email: string;
  birthday: Dayjs | null;
  locale: Customer['locale'];
  tags: string[];
  allergies: string;
  preferences: string;
  notes: string;
}

export type ProfileIssue = 'email_invalid' | 'tag_invalid' | 'too_many_tags' | 'text_too_long';
export type ProfileErrors = Partial<Record<'name' | 'email' | 'tags' | 'allergies' | 'preferences' | 'notes', ProfileIssue>>;

/** Тег как на сервере: нижний регистр, пробелы → дефис. */
export function normalizeTagInput(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

export function isValidTag(tag: string): boolean {
  return tag.length > 0 && tag.length <= PROFILE_LIMITS.tag && TAG_RE.test(tag);
}

export function customerToProfileForm(customer: Customer): ProfileFormValues {
  return {
    name: customer.name ?? '',
    email: customer.email ?? '',
    birthday: customer.birthday ? dayjs(customer.birthday) : null,
    locale: customer.locale,
    tags: [...customer.tags],
    allergies: customer.allergies ?? '',
    preferences: customer.preferences ?? '',
    notes: customer.notes ?? '',
  };
}

export function validateProfile(values: ProfileFormValues): ProfileErrors {
  const errors: ProfileErrors = {};
  if (values.name.trim().length > PROFILE_LIMITS.name) errors.name = 'text_too_long';
  const email = values.email.trim();
  if (email && (email.length > PROFILE_LIMITS.email || !EMAIL_RE.test(email))) errors.email = 'email_invalid';
  const tags = [...new Set(values.tags.map(normalizeTagInput))];
  if (tags.some((tag) => !isValidTag(tag))) errors.tags = 'tag_invalid';
  else if (tags.length > PROFILE_LIMITS.tags) errors.tags = 'too_many_tags';
  for (const field of ['allergies', 'preferences', 'notes'] as const) {
    if (values[field].trim().length > PROFILE_LIMITS[field]) errors[field] = 'text_too_long';
  }
  return errors;
}

/** Тело PATCH /admin/customers/{id}: пустые поля → null, теги — полный набор (заменяет текущий). */
export function toUpdateCustomerBody(values: ProfileFormValues): UpdateCustomerBody {
  const text = (value: string) => value.trim() || null;
  return {
    name: text(values.name),
    email: text(values.email)?.toLowerCase() ?? null,
    birthday: values.birthday ? values.birthday.format('YYYY-MM-DD') : null,
    locale: values.locale,
    tags: [...new Set(values.tags.map(normalizeTagInput).filter(Boolean))],
    allergies: text(values.allergies),
    preferences: text(values.preferences),
    notes: text(values.notes),
  };
}
