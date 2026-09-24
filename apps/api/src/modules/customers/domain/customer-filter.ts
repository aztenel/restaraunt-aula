import { ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';
import { isIsoDate } from '../../../shared/kernel/time';
import { normalizeTag } from './customer';

/**
 * Фильтр базы гостей: поиск в списке, сохранённые сегменты, выгрузки.
 * Гости — общие для сети (не принадлежат филиалу); фильтр по филиалу означает
 * «была активность в филиале».
 */
export interface CustomerFilter {
  /** Поиск по телефону (цифры), имени или почте. */
  q?: string;
  /** Все перечисленные теги должны быть у гостя. */
  tags?: string[];
  /** Сумма покупок за всё время, тиыны (включительно). */
  spentMin?: number;
  spentMax?: number;
  /** Последняя активность, локальные даты YYYY-MM-DD (Asia/Almaty), включительно. */
  lastActivityFrom?: string;
  lastActivityTo?: string;
  /** Была активность (заказ, бронь, банкет) в филиале. */
  branchId?: string;
  hasBanquet?: boolean;
  marketingConsent?: boolean;
}

const FILTER_KEYS: ReadonlyArray<keyof CustomerFilter> = [
  'q',
  'tags',
  'spentMin',
  'spentMax',
  'lastActivityFrom',
  'lastActivityTo',
  'branchId',
  'hasBanquet',
  'marketingConsent',
];

function invalid(field: string, message: string): ValidationError {
  return new ValidationError('customer_filter.invalid', message, { field });
}

/** Проверяет и нормализует фильтр (из запроса или сохранённого сегмента). Пустые поля отбрасываются. */
export function normalizeCustomerFilter(raw: unknown): CustomerFilter {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) throw invalid('filter', 'Filter must be an object');
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(FILTER_KEYS as readonly string[]).includes(key)) throw invalid(key, `Unknown filter field ${key}`);
  }
  const f: CustomerFilter = {};
  if (input.q !== undefined && input.q !== null) {
    if (typeof input.q !== 'string' || input.q.length > 100) throw invalid('q', 'q must be a string up to 100 chars');
    const q = input.q.trim();
    if (q) f.q = q;
  }
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== 'string')) throw invalid('tags', 'tags must be strings');
    const tags = [...new Set((input.tags as string[]).filter((t) => t.trim()).map(normalizeTag))];
    if (tags.length > 20) throw invalid('tags', 'At most 20 tags');
    if (tags.length) f.tags = tags;
  }
  for (const key of ['spentMin', 'spentMax'] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalid(key, `${key} must be a non-negative integer (tiyn)`);
    f[key] = value;
  }
  if (f.spentMin !== undefined && f.spentMax !== undefined && f.spentMin > f.spentMax) {
    throw invalid('spentMin', 'spentMin must not exceed spentMax');
  }
  for (const key of ['lastActivityFrom', 'lastActivityTo'] as const) {
    const value = input[key];
    if (value === undefined || value === null || value === '') continue;
    if (typeof value !== 'string' || !isIsoDate(value)) throw invalid(key, `${key} must be YYYY-MM-DD`);
    f[key] = value;
  }
  if (f.lastActivityFrom && f.lastActivityTo && f.lastActivityFrom > f.lastActivityTo) {
    throw invalid('lastActivityFrom', 'lastActivityFrom must not be after lastActivityTo');
  }
  if (input.branchId !== undefined && input.branchId !== null) {
    if (!isUuid(input.branchId)) throw invalid('branchId', 'branchId must be a UUID');
    f.branchId = input.branchId;
  }
  for (const key of ['hasBanquet', 'marketingConsent'] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') throw invalid(key, `${key} must be boolean`);
    f[key] = value;
  }
  return f;
}

/** Фильтр сегмента + уточнения из запроса (уточнения перекрывают поля сегмента; теги объединяются). */
export function mergeFilters(base: CustomerFilter, override: CustomerFilter): CustomerFilter {
  const merged: CustomerFilter = { ...base, ...override };
  if (base.tags || override.tags) merged.tags = [...new Set([...(base.tags ?? []), ...(override.tags ?? [])])];
  return normalizeCustomerFilter(merged);
}

/**
 * Шаблоны LIKE для поиска по телефону (от 3 цифр): вхождение цифр в номер, а для ввода с «8»
 * в начале (8 701 ...) — ещё и номер, начинающийся с +7 и остальных цифр.
 */
export function phoneSearchPatterns(q: string): string[] {
  if (/[^\d\s()+-]/.test(q)) return [];
  const digits = q.replace(/\D/g, '');
  if (digits.length < 3) return [];
  const patterns = [`%${digits}%`];
  if (digits.startsWith('8') && digits.length >= 4) patterns.push(`+7${digits.slice(1)}%`);
  return patterns;
}

/** Экранирование спецсимволов LIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
