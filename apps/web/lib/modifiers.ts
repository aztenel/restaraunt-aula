/**
 * Выбор модификаторов на карточке блюда — только ОТОБРАЖЕНИЕ правил, пришедших с сервера
 * (minSelect / maxSelect / isRequired / isDefault у групп и опций). Витрина:
 *  - предвыбирает опции по умолчанию;
 *  - рисует группу радиокнопками (выбор одного) или флажками (несколько);
 *  - не даёт отметить больше maxSelect и подсказывает, где выбор ещё не сделан.
 * Цену с добавками витрина НЕ считает: доплаты опций показываются как есть, итог — из
 * POST /api/v1/public/orders/quote. Окончательную проверку выбора делает сервер
 * (catalog.modifier_invalid в расчёте корзины).
 */
import type { ModifierGroup } from './api-types';

/** Выбранные опции по группам: groupId → optionIds (в порядке опций группы). */
export type ModifierSelection = Record<string, string[]>;

type GroupRules = Pick<ModifierGroup, 'id' | 'minSelect' | 'maxSelect' | 'isRequired' | 'options'>;

export function isGroupRequired(group: Pick<ModifierGroup, 'minSelect' | 'isRequired'>): boolean {
  return group.isRequired || group.minSelect >= 1;
}

/** maxSelect = 1 → радиокнопки, иначе флажки. */
export function selectionMode(group: Pick<ModifierGroup, 'maxSelect'>): 'single' | 'multiple' {
  return group.maxSelect <= 1 ? 'single' : 'multiple';
}

function inGroupOrder(group: GroupRules, ids: Iterable<string>): string[] {
  const set = new Set(ids);
  return group.options.filter((option) => set.has(option.id)).map((option) => option.id);
}

/** Начальный выбор: опции по умолчанию (не больше maxSelect). */
export function initialSelection(groups: readonly GroupRules[]): ModifierSelection {
  const selection: ModifierSelection = {};
  for (const group of groups) {
    const defaults = group.options.filter((option) => option.isDefault).map((option) => option.id);
    selection[group.id] = defaults.slice(0, Math.max(0, group.maxSelect));
  }
  return selection;
}

/**
 * Нажатие на опцию.
 *  - один вариант: выбрать его; в необязательной группе повторное нажатие снимает выбор;
 *  - несколько: снять/отметить; сверх maxSelect не отмечается (опция в интерфейсе недоступна).
 */
export function toggleOption(
  groups: readonly GroupRules[],
  selection: ModifierSelection,
  groupId: string,
  optionId: string,
): ModifierSelection {
  const group = groups.find((g) => g.id === groupId);
  if (!group || !group.options.some((option) => option.id === optionId)) return selection;
  const current = selection[groupId] ?? [];
  const selected = current.includes(optionId);
  let next: string[];
  if (selectionMode(group) === 'single') {
    if (selected) {
      if (isGroupRequired(group)) return selection;
      next = [];
    } else {
      next = [optionId];
    }
  } else if (selected) {
    next = current.filter((id) => id !== optionId);
  } else {
    if (current.length >= group.maxSelect) return selection;
    next = inGroupOrder(group, [...current, optionId]);
  }
  return { ...selection, [groupId]: next };
}

export function isOptionSelected(selection: ModifierSelection, groupId: string, optionId: string): boolean {
  return (selection[groupId] ?? []).includes(optionId);
}

/** Флажок недоступен: в группе уже отмечено maxSelect опций (выбранные можно снять). */
export function isOptionDisabled(group: GroupRules, selection: ModifierSelection, optionId: string): boolean {
  if (selectionMode(group) === 'single') return false;
  const current = selection[group.id] ?? [];
  return !current.includes(optionId) && current.length >= group.maxSelect;
}

export type GroupRuleKind = 'optionalOne' | 'optionalUpTo' | 'requiredOne' | 'requiredExactly' | 'requiredRange';

export interface GroupRule {
  kind: GroupRuleKind;
  min: number;
  max: number;
}

/** Подпись правила группы («Обязательно, выберите один», «Необязательно, до 3»…) — ключ перевода + числа. */
export function groupRule(group: Pick<ModifierGroup, 'minSelect' | 'maxSelect' | 'isRequired'>): GroupRule {
  const max = Math.max(1, group.maxSelect);
  const min = Math.min(max, Math.max(isGroupRequired(group) ? 1 : 0, group.minSelect));
  if (min === 0) return { kind: max === 1 ? 'optionalOne' : 'optionalUpTo', min, max };
  if (max === 1) return { kind: 'requiredOne', min, max };
  if (min === max) return { kind: 'requiredExactly', min, max };
  return { kind: 'requiredRange', min, max };
}

/** Группы, где выбрано меньше minSelect (подсказка гостю; окончательно проверяет сервер). */
export function unmetGroups(groups: readonly GroupRules[], selection: ModifierSelection): string[] {
  return groups
    .filter((group) => (selection[group.id] ?? []).length < (isGroupRequired(group) ? Math.max(1, group.minSelect) : 0))
    .map((group) => group.id);
}

/** Выбранные опции для корзины (порядок: группы блюда, затем опции группы). */
export function selectedOptionIds(groups: readonly GroupRules[], selection: ModifierSelection): string[] {
  return groups.flatMap((group) => inGroupOrder(group, selection[group.id] ?? []));
}

/** «Не нужно» в необязательной группе с выбором одного варианта: снять выбор (в обязательной — без изменений). */
export function clearGroup(groups: readonly GroupRules[], selection: ModifierSelection, groupId: string): ModifierSelection {
  const group = groups.find((g) => g.id === groupId);
  if (!group || isGroupRequired(group) || (selection[groupId] ?? []).length === 0) return selection;
  return { ...selection, [groupId]: [] };
}
