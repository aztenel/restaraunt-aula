import { describe, expect, it } from 'vitest';
import type { ModifierGroup } from '@/lib/api-types';
import {
  clearGroup,
  groupRule,
  initialSelection,
  isOptionDisabled,
  selectedOptionIds,
  selectionMode,
  toggleOption,
  unmetGroups,
} from '@/lib/modifiers';

const money = (amount: number) => ({ amount, currency: 'KZT' as const });

function group(id: string, minSelect: number, maxSelect: number, options: Array<[string, boolean?]>): ModifierGroup {
  return {
    id,
    name: id,
    description: '',
    minSelect,
    maxSelect,
    isRequired: minSelect >= 1,
    options: options.map(([optionId, isDefault = false]) => ({ id: optionId, name: optionId, price: money(0), isDefault })),
  };
}

// Размер порции: обязательно один (по умолчанию «стандарт»); соус: необязательно один;
// добавки: необязательно до 2; гарнир: обязательно от 1 до 2.
const size = group('size', 1, 1, [['std', true], ['big']]);
const sauce = group('sauce', 0, 1, [['garlic'], ['spicy']]);
const extras = group('extras', 0, 2, [['cheese'], ['egg'], ['kazy']]);
const side = group('side', 1, 2, [['rice'], ['fries'], ['salad']]);
const groups = [size, sauce, extras, side];

describe('выбор модификаторов (отображение правил сервера)', () => {
  it('предвыбирает опции по умолчанию, не больше maxSelect', () => {
    const many = group('many', 0, 1, [['a', true], ['b', true]]);
    expect(initialSelection([size, sauce, many])).toEqual({ size: ['std'], sauce: [], many: ['a'] });
  });

  it('maxSelect = 1 — радиокнопки, иначе флажки', () => {
    expect(selectionMode(size)).toBe('single');
    expect(selectionMode(extras)).toBe('multiple');
  });

  it('один вариант: выбор заменяет предыдущий; в обязательной группе снять нельзя, в необязательной — можно', () => {
    let s = initialSelection(groups);
    s = toggleOption(groups, s, 'size', 'big');
    expect(s.size).toEqual(['big']);
    expect(toggleOption(groups, s, 'size', 'big')).toBe(s);
    s = toggleOption(groups, s, 'sauce', 'garlic');
    expect(s.sauce).toEqual(['garlic']);
    s = toggleOption(groups, s, 'sauce', 'garlic');
    expect(s.sauce).toEqual([]);
    s = toggleOption(groups, s, 'sauce', 'spicy');
    expect(clearGroup(groups, s, 'sauce').sauce).toEqual([]);
    expect(clearGroup(groups, s, 'size')).toBe(s);
  });

  it('несколько: не больше maxSelect, лишние опции недоступны, выбранные можно снять', () => {
    let s = initialSelection(groups);
    s = toggleOption(groups, s, 'extras', 'kazy');
    s = toggleOption(groups, s, 'extras', 'cheese');
    expect(s.extras).toEqual(['cheese', 'kazy']); // порядок опций группы
    expect(isOptionDisabled(extras, s, 'egg')).toBe(true);
    expect(isOptionDisabled(extras, s, 'cheese')).toBe(false);
    expect(toggleOption(groups, s, 'extras', 'egg')).toBe(s);
    s = toggleOption(groups, s, 'extras', 'cheese');
    expect(isOptionDisabled(extras, s, 'egg')).toBe(false);
  });

  it('подписи правил групп', () => {
    expect(groupRule(size)).toEqual({ kind: 'requiredOne', min: 1, max: 1 });
    expect(groupRule(sauce)).toEqual({ kind: 'optionalOne', min: 0, max: 1 });
    expect(groupRule(extras)).toEqual({ kind: 'optionalUpTo', min: 0, max: 2 });
    expect(groupRule(side)).toEqual({ kind: 'requiredRange', min: 1, max: 2 });
    expect(groupRule(group('two', 2, 2, [['a'], ['b'], ['c']]))).toEqual({ kind: 'requiredExactly', min: 2, max: 2 });
    // isRequired от сервера без minSelect всё равно показывается как обязательная.
    expect(groupRule({ minSelect: 0, maxSelect: 1, isRequired: true }).kind).toBe('requiredOne');
  });

  it('подсказывает незаполненные обязательные группы и собирает опции для корзины', () => {
    let s = initialSelection(groups);
    expect(unmetGroups(groups, s)).toEqual(['side']);
    s = toggleOption(groups, s, 'side', 'salad');
    s = toggleOption(groups, s, 'extras', 'egg');
    expect(unmetGroups(groups, s)).toEqual([]);
    expect(selectedOptionIds(groups, s)).toEqual(['std', 'egg', 'salad']);
  });

  it('игнорирует чужие группы и опции', () => {
    const s = initialSelection(groups);
    expect(toggleOption(groups, s, 'nope', 'std')).toBe(s);
    expect(toggleOption(groups, s, 'size', 'cheese')).toBe(s);
  });
});
