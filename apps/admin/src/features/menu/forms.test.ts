import { describe, expect, it } from 'vitest';
import type { Category, Dish, ModifierGroup } from '@aula/api-client';
import { parseMoneyInput } from '@/shared/ui/money-input';
import {
  categoryToForm,
  cleanTranslatable,
  dishToForm,
  formToCategoryInput,
  formToDishInput,
  formToModifierGroupInput,
  modifierGroupIssues,
  modifierGroupToForm,
  toggleDefaultOption,
  type ModifierGroupFormValues,
} from './forms';

const category: Category = {
  id: 'c1',
  slug: 'salaty',
  name: { ru: 'Салаты', kk: 'Салаттар' },
  description: { ru: 'Свежие' },
  seoTitle: {},
  seoDescription: {},
  image: null,
  sortOrder: 20,
  isActive: true,
  dishCount: 3,
  missingTranslations: [{ field: 'description', missing: ['kk'] }],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const dish: Dish = {
  id: 'd1',
  slug: 'beshbarmak',
  categoryId: 'c1',
  name: { ru: 'Бешбармак', kk: 'Ет' },
  description: { ru: 'Конина' },
  composition: {},
  seoTitle: {},
  seoDescription: {},
  weightGrams: 450,
  calories: null,
  isVegetarian: false,
  spicyLevel: 1,
  isHalal: true,
  allergens: ['gluten'],
  sku: 'BSH-01',
  sortOrder: 10,
  isActive: true,
  photos: [],
  modifierGroupIds: ['g2', 'g1'],
  missingTranslations: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('переводимые поля (TranslatableInput → DTO)', () => {
  it('убирает пустые языки и пробелы по краям, неизвестные ключи не передаются', () => {
    expect(cleanTranslatable({ ru: '  Плов ', kk: '   ', en: '' })).toEqual({ ru: 'Плов' });
    expect(cleanTranslatable({ kk: 'Палау', ru: 'Плов', en: 'Pilaf', ...({ de: 'x' } as object) })).toEqual({ kk: 'Палау', ru: 'Плов', en: 'Pilaf' });
    expect(cleanTranslatable(null)).toEqual({});
  });
});

describe('категория: форма ⇄ CategoryInput', () => {
  it('все поля передаются явно (иначе сервер оставит прежние), порядок — не из формы', () => {
    const values = categoryToForm(category);
    values.description = { ru: '' };
    const input = formToCategoryInput(values);
    expect(input).toEqual({
      slug: 'salaty',
      name: { ru: 'Салаты', kk: 'Салаттар' },
      description: {},
      seoTitle: {},
      seoDescription: {},
      isActive: true,
    });
    expect(input).not.toHaveProperty('sortOrder');
  });

  it('пустой slug → null (сервер транслитерирует название), регистр приводится к нижнему', () => {
    expect(formToCategoryInput({ ...categoryToForm(null), name: { ru: 'Супы' }, slug: '  ' }).slug).toBeNull();
    expect(formToCategoryInput({ ...categoryToForm(null), name: { ru: 'Супы' }, slug: 'Supy' }).slug).toBe('supy');
  });
});

describe('блюдо: форма ⇄ DishInput', () => {
  it('переносит атрибуты, порядок групп модификаторов и пустые числа как null', () => {
    const values = dishToForm(dish);
    values.calories = null;
    values.sku = '';
    values.composition = { kk: ' Ет, қамыр ' };
    const input = formToDishInput(values);
    expect(input).toMatchObject({
      slug: 'beshbarmak',
      categoryId: 'c1',
      weightGrams: 450,
      calories: null,
      spicyLevel: 1,
      isHalal: true,
      isVegetarian: false,
      allergens: ['gluten'],
      sku: null,
      composition: { kk: 'Ет, қамыр' },
      modifierGroupIds: ['g2', 'g1'],
    });
    // Цены в карточке блюда нет — она в меню филиала.
    expect(input).not.toHaveProperty('price');
  });

  it('новое блюдо: халал по умолчанию, без категории отправить нельзя', () => {
    const values = dishToForm(null, { categoryId: 'c9' });
    expect(values.isHalal).toBe(true);
    expect(values.spicyLevel).toBe(0);
    expect(formToDishInput({ ...values, name: { ru: 'Лагман' } }).categoryId).toBe('c9');
    expect(() => formToDishInput({ ...values, categoryId: undefined })).toThrow();
  });

  it('аллергены без повторов', () => {
    expect(formToDishInput({ ...dishToForm(dish), allergens: ['milk', 'milk', 'eggs'] }).allergens).toEqual(['milk', 'eggs']);
  });
});

describe('группа модификаторов: цены опций в тиынах (MoneyInput)', () => {
  const group: ModifierGroup = {
    id: 'g1',
    code: 'portion',
    name: { ru: 'Порция' },
    description: {},
    minSelect: 1,
    maxSelect: 1,
    isRequired: true,
    sortOrder: 0,
    isActive: true,
    options: [
      { id: 'o2', name: { ru: 'Большая' }, price: { amount: 150050, currency: 'KZT' }, isDefault: false, sortOrder: 20, isActive: true },
      { id: 'o1', name: { ru: 'Обычная' }, price: { amount: 0, currency: 'KZT' }, isDefault: true, sortOrder: 10, isActive: true },
    ],
    dishCount: 2,
    createdAt: '',
    updatedAt: '',
  };

  it('опции по sortOrder, цена — целые тиыны из ответа сервера', () => {
    const values = modifierGroupToForm(group);
    expect(values.options.map((o) => o.id)).toEqual(['o1', 'o2']);
    expect(values.options[1]!.price).toBe(150050);
  });

  it('ввод «1 500,50» → 150050 тиынов → { amount, currency: KZT }; порядок → sortOrder', () => {
    const values = modifierGroupToForm(group);
    const parsed = parseMoneyInput('1 500,50');
    values.options.push({ name: { ru: 'Двойная' }, price: parsed.value, isDefault: false, isActive: true });
    const input = formToModifierGroupInput(values);
    expect(input.options).toEqual([
      { id: 'o1', name: { ru: 'Обычная' }, price: { amount: 0, currency: 'KZT' }, isDefault: true, sortOrder: 10, isActive: true },
      { id: 'o2', name: { ru: 'Большая' }, price: { amount: 150050, currency: 'KZT' }, isDefault: false, sortOrder: 20, isActive: true },
      { name: { ru: 'Двойная' }, price: { amount: 150050, currency: 'KZT' }, isDefault: false, sortOrder: 30, isActive: true },
    ]);
    expect(Number.isInteger(input.options[2]!.price.amount)).toBe(true);
  });

  it('подсказки формы — те же правила, что на сервере', () => {
    const base: ModifierGroupFormValues = modifierGroupToForm(group);
    expect(modifierGroupIssues(base)).toEqual([]);
    expect(modifierGroupIssues({ ...base, minSelect: 2, maxSelect: 1 })).toContain('min_greater_than_max');
    expect(modifierGroupIssues({ ...base, options: base.options.map((o) => ({ ...o, isActive: false })) })).toContain('no_options');
    expect(modifierGroupIssues({ ...base, minSelect: 3, maxSelect: 5 })).toContain('min_exceeds_options');
    expect(modifierGroupIssues({ ...base, options: base.options.map((o) => ({ ...o, isDefault: true })) })).toContain('too_many_defaults');
    expect(modifierGroupIssues({ ...base, options: [...base.options, { name: { en: 'x' }, price: 0, isDefault: false, isActive: true }] })).toContain(
      'option_name_required',
    );
  });

  it('при максимуме 1 отметка «по умолчанию» переносится на другую опцию', () => {
    const options = modifierGroupToForm(group).options;
    const next = toggleDefaultOption(options, 1, true, 1);
    expect(next.map((o) => o.isDefault)).toEqual([false, true]);
    const multi = toggleDefaultOption(options, 1, true, 2);
    expect(multi.map((o) => o.isDefault)).toEqual([true, true]);
  });
});
