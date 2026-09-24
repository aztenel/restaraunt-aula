import { ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';

/**
 * Сопоставление блюда витрины с товаром POS в филиале. Внешние идентификаторы — строки POS
 * (GUID, артикул — зависит от системы), модуль их не интерпретирует.
 */
export interface ModifierMapping {
  externalProductId: string;
  /** Группа модификаторов в POS (нужна для групповых модификаторов). */
  externalGroupId: string | null;
}

export interface DishMapping {
  dishId: string;
  externalProductId: string;
  /** Опции модификаторов витрины (optionId) -> товары-модификаторы POS. */
  modifiers: Record<string, ModifierMapping>;
}

export const EXTERNAL_ID_MAX_LENGTH = 200;
export const EXTERNAL_NAME_MAX_LENGTH = 300;
export const MAX_MODIFIER_MAPPINGS = 200;
const PROVIDER_RE = /^[a-z0-9_]+$/;

export interface MappingInput {
  externalProductId: string;
  externalName?: string | null;
  modifiers?: Array<{ optionId: string; externalProductId: string; externalGroupId?: string | null }>;
}

export interface NormalizedMapping {
  externalProductId: string;
  externalName: string | null;
  modifiers: Record<string, ModifierMapping>;
}

function externalId(value: string | null | undefined, field: string): string {
  const text = (value ?? '').trim();
  if (!text) throw new ValidationError('pos.mapping_invalid', `${field} is required`, { field });
  if (text.length > EXTERNAL_ID_MAX_LENGTH || /[\u0000-\u001f]/.test(text)) {
    throw new ValidationError('pos.mapping_invalid', `${field} is invalid`, { field });
  }
  return text;
}

export function assertProviderName(provider: string): string {
  if (!PROVIDER_RE.test(provider)) {
    throw new ValidationError('pos.unknown_provider', 'Unknown POS provider', { provider });
  }
  return provider;
}

/** Проверка и нормализация ввода сопоставления из админки. */
export function normalizeMapping(input: MappingInput): NormalizedMapping {
  const externalProductId = externalId(input.externalProductId, 'externalProductId');
  const name = input.externalName?.trim() || null;
  if (name && name.length > EXTERNAL_NAME_MAX_LENGTH) {
    throw new ValidationError('pos.mapping_invalid', 'externalName is too long', { field: 'externalName' });
  }
  const list = input.modifiers ?? [];
  if (list.length > MAX_MODIFIER_MAPPINGS) {
    throw new ValidationError('pos.mapping_invalid', `Too many modifier mappings (max ${MAX_MODIFIER_MAPPINGS})`, { field: 'modifiers' });
  }
  const modifiers: Record<string, ModifierMapping> = {};
  for (const item of list) {
    if (!isUuid(item.optionId)) {
      throw new ValidationError('pos.mapping_invalid', 'optionId must be a modifier option id', { field: 'modifiers', optionId: item.optionId });
    }
    if (modifiers[item.optionId]) {
      throw new ValidationError('pos.mapping_duplicate_option', 'Modifier option is mapped twice', { optionId: item.optionId });
    }
    const group = item.externalGroupId?.trim() || null;
    modifiers[item.optionId] = {
      externalProductId: externalId(item.externalProductId, 'modifiers.externalProductId'),
      externalGroupId: group ? externalId(group, 'modifiers.externalGroupId') : null,
    };
  }
  return { externalProductId, externalName: name, modifiers };
}

/** Разбор JSON из БД (защита от ручных правок и старых форматов). */
export function parseModifierMappings(raw: unknown): Record<string, ModifierMapping> {
  const result: Record<string, ModifierMapping> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [optionId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as { externalProductId?: unknown; externalGroupId?: unknown };
    if (typeof v.externalProductId !== 'string' || !v.externalProductId) continue;
    result[optionId] = {
      externalProductId: v.externalProductId,
      externalGroupId: typeof v.externalGroupId === 'string' && v.externalGroupId ? v.externalGroupId : null,
    };
  }
  return result;
}
