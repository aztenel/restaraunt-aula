import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Модификаторы: группа (размер порции, соус, добавки) с опциями. У группы — min/max выбора,
 * обязательность = min >= 1. Цена опции — в тиынах (может быть 0). Группы привязываются к блюдам
 * (многие ко многим, упорядоченно).
 */
export const MAX_MODIFIER_SELECT = 20;
export const MAX_OPTIONS_PER_GROUP = 50;

export interface ModifierOptionRule {
  id: string;
  name: Translatable;
  price: Money;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface ModifierGroupRule {
  id: string;
  name: Translatable;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: ModifierOptionRule[];
}

export function isRequiredGroup(group: Pick<ModifierGroupRule, 'minSelect'>): boolean {
  return group.minSelect >= 1;
}

function configError(reason: string, message: string, details: Record<string, unknown> = {}): ValidationError {
  return new ValidationError('catalog.modifier_group_invalid', message, { reason, ...details });
}

/**
 * Проверка настройки группы при сохранении в админке:
 * 0 <= min <= max <= 20, max >= 1; есть хотя бы одна активная опция; min не больше числа активных опций;
 * опций по умолчанию не больше max; цена опции — целые тиыны >= 0.
 */
export function validateModifierGroupConfig(input: {
  minSelect: number;
  maxSelect: number;
  options: Array<Pick<ModifierOptionRule, 'price' | 'isDefault' | 'isActive'>>;
}): void {
  const { minSelect, maxSelect, options } = input;
  if (!Number.isInteger(minSelect) || !Number.isInteger(maxSelect) || minSelect < 0 || maxSelect < 1 || maxSelect > MAX_MODIFIER_SELECT) {
    throw configError('bounds', `minSelect >= 0, 1 <= maxSelect <= ${MAX_MODIFIER_SELECT}`, { minSelect, maxSelect });
  }
  if (minSelect > maxSelect) {
    throw configError('min_greater_than_max', 'minSelect must not exceed maxSelect', { minSelect, maxSelect });
  }
  if (options.length > MAX_OPTIONS_PER_GROUP) {
    throw configError('too_many_options', `At most ${MAX_OPTIONS_PER_GROUP} options per group`);
  }
  const active = options.filter((o) => o.isActive);
  if (active.length === 0) {
    throw configError('no_options', 'Group must have at least one active option');
  }
  if (minSelect > active.length) {
    throw configError('min_exceeds_options', 'minSelect exceeds the number of active options', { minSelect, options: active.length });
  }
  const defaults = active.filter((o) => o.isDefault).length;
  if (defaults > maxSelect) {
    throw configError('too_many_defaults', 'More default options than maxSelect', { defaults, maxSelect });
  }
  for (const option of options) {
    if (option.price.isNegative()) {
      throw configError('negative_price', 'Option price must not be negative');
    }
  }
}

export interface ResolvedModifier {
  group: ModifierGroupRule;
  option: ModifierOptionRule;
}

function selectionError(reason: string, message: string, details: Record<string, unknown>): ValidationError {
  return new ValidationError('catalog.modifier_invalid', message, { reason, ...details });
}

/**
 * Разбор выбранных опций для блюда (сервер пересчитывает всё сам, фронт только передаёт id опций):
 * - опция должна принадлежать активной группе блюда и быть активной;
 * - повтор одной опции запрещён;
 * - число опций в группе — в пределах [min, max];
 * - если в обязательной группе ничего не выбрано — подставляются опции по умолчанию (если их хватает);
 *   в необязательной группе пустой выбор означает «без модификатора».
 * Порядок результата — порядок групп у блюда, затем порядок опций в группе.
 */
export function resolveModifierSelection(
  groups: readonly ModifierGroupRule[],
  optionIds: readonly string[],
  context: Record<string, unknown> = {},
): ResolvedModifier[] {
  const activeGroups = groups.filter((g) => g.isActive);
  const index = new Map<string, ResolvedModifier>();
  for (const group of activeGroups) {
    for (const option of group.options) {
      if (option.isActive) index.set(option.id, { group, option });
    }
  }
  const seen = new Set<string>();
  const byGroup = new Map<string, ResolvedModifier[]>();
  for (const optionId of optionIds) {
    if (seen.has(optionId)) {
      throw selectionError('duplicate_option', 'Modifier option selected twice', { ...context, optionId });
    }
    seen.add(optionId);
    const resolved = index.get(optionId);
    if (!resolved) {
      throw selectionError('option_not_available', 'Modifier option does not belong to the dish', { ...context, optionId });
    }
    byGroup.set(resolved.group.id, [...(byGroup.get(resolved.group.id) ?? []), resolved]);
  }

  const result: ResolvedModifier[] = [];
  for (const group of activeGroups) {
    let selected = byGroup.get(group.id) ?? [];
    if (selected.length === 0 && isRequiredGroup(group)) {
      selected = group.options.filter((o) => o.isActive && o.isDefault).map((option) => ({ group, option }));
    }
    if (selected.length < group.minSelect) {
      throw selectionError('too_few', 'Required modifier group is not selected', {
        ...context,
        groupId: group.id,
        minSelect: group.minSelect,
        selected: selected.length,
      });
    }
    if (selected.length > group.maxSelect) {
      throw selectionError('too_many', 'Too many options in modifier group', {
        ...context,
        groupId: group.id,
        maxSelect: group.maxSelect,
        selected: selected.length,
      });
    }
    const order = new Map(group.options.map((o, i) => [o.id, i]));
    result.push(...[...selected].sort((a, b) => (order.get(a.option.id) ?? 0) - (order.get(b.option.id) ?? 0)));
  }
  return result;
}
