/**
 * Формы каталога ⇄ DTO API. Только перенос значений: переводимые поля { kk, ru, en } без пустых языков,
 * пустые строки → null, деньги — целые тиыны { amount } (ввод MoneyInput). Никаких расчётов цен.
 * Сервер нормализует повторно и остаётся единственным источником правил.
 */
import {
  LOCALES,
  type Category,
  type CategoryInput,
  type Dish,
  type DishInput,
  type ModifierGroup,
  type ModifierGroupInput,
  type Translatable,
} from '@aula/api-client';

/** Переводимое поле без пустых языков (пробелы по краям убираются). */
export function cleanTranslatable(value: Translatable | null | undefined): Translatable {
  const result: Translatable = {};
  for (const locale of LOCALES) {
    const text = value?.[locale]?.trim();
    if (text) result[locale] = text;
  }
  return result;
}

/** Пустая строка → null (сервер: null — «не задано / сбросить»). */
export function emptyToNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/** Число из InputNumber: пусто → null. */
export function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------- Категория

export interface CategoryFormValues {
  slug: string;
  name: Translatable;
  description: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  isActive: boolean;
}

export function categoryToForm(category: Category | null): CategoryFormValues {
  return {
    slug: category?.slug ?? '',
    name: category?.name ?? {},
    description: category?.description ?? {},
    seoTitle: category?.seoTitle ?? {},
    seoDescription: category?.seoDescription ?? {},
    isActive: category?.isActive ?? true,
  };
}

/**
 * Все поля передаются явно (иначе сервер оставит прежние значения). Порядок (sortOrder) меняется
 * только перетаскиванием в списке — в форме не передаётся.
 */
export function formToCategoryInput(values: CategoryFormValues): CategoryInput {
  return {
    slug: emptyToNull(values.slug?.toLowerCase()),
    name: cleanTranslatable(values.name),
    description: cleanTranslatable(values.description),
    seoTitle: cleanTranslatable(values.seoTitle),
    seoDescription: cleanTranslatable(values.seoDescription),
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- Блюдо

export const SPICY_LEVELS = [0, 1, 2, 3] as const;

export interface DishFormValues {
  slug: string;
  categoryId: string | undefined;
  name: Translatable;
  description: Translatable;
  composition: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  weightGrams: number | null;
  calories: number | null;
  isVegetarian: boolean;
  spicyLevel: number;
  isHalal: boolean;
  allergens: string[];
  sku: string;
  sortOrder: number | null;
  isActive: boolean;
  /** Группы модификаторов в порядке показа. */
  modifierGroupIds: string[];
}

export function dishToForm(dish: Dish | null, defaults: { categoryId?: string } = {}): DishFormValues {
  return {
    slug: dish?.slug ?? '',
    categoryId: dish?.categoryId ?? defaults.categoryId,
    name: dish?.name ?? {},
    description: dish?.description ?? {},
    composition: dish?.composition ?? {},
    seoTitle: dish?.seoTitle ?? {},
    seoDescription: dish?.seoDescription ?? {},
    weightGrams: dish?.weightGrams ?? null,
    calories: dish?.calories ?? null,
    isVegetarian: dish?.isVegetarian ?? false,
    spicyLevel: dish?.spicyLevel ?? 0,
    // Сеть сертифицирована халал: по умолчанию «да» (как на сервере).
    isHalal: dish?.isHalal ?? true,
    allergens: dish?.allergens ?? [],
    sku: dish?.sku ?? '',
    sortOrder: dish?.sortOrder ?? null,
    isActive: dish?.isActive ?? true,
    modifierGroupIds: dish?.modifierGroupIds ?? [],
  };
}

export function formToDishInput(values: DishFormValues): DishInput {
  if (!values.categoryId) throw new Error('categoryId is required');
  return {
    slug: emptyToNull(values.slug?.toLowerCase()),
    categoryId: values.categoryId,
    name: cleanTranslatable(values.name),
    description: cleanTranslatable(values.description),
    composition: cleanTranslatable(values.composition),
    seoTitle: cleanTranslatable(values.seoTitle),
    seoDescription: cleanTranslatable(values.seoDescription),
    weightGrams: numberOrNull(values.weightGrams),
    calories: numberOrNull(values.calories),
    isVegetarian: values.isVegetarian,
    spicyLevel: values.spicyLevel,
    isHalal: values.isHalal,
    allergens: [...new Set(values.allergens)],
    sku: emptyToNull(values.sku),
    sortOrder: numberOrNull(values.sortOrder),
    isActive: values.isActive,
    modifierGroupIds: [...values.modifierGroupIds],
  };
}

// ---------------------------------------------------------------- Группа модификаторов

export interface ModifierOptionFormValues {
  /** Существующая опция (сохраняет id — история заказов ссылается на него). */
  id?: string;
  name: Translatable;
  /** Доплата в тиынах (MoneyInput). */
  price: number | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface ModifierGroupFormValues {
  code: string;
  name: Translatable;
  description: Translatable;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: ModifierOptionFormValues[];
}

export function modifierGroupToForm(group: ModifierGroup | null): ModifierGroupFormValues {
  return {
    code: group?.code ?? '',
    name: group?.name ?? {},
    description: group?.description ?? {},
    minSelect: group?.minSelect ?? 0,
    maxSelect: group?.maxSelect ?? 1,
    isActive: group?.isActive ?? true,
    options: group
      ? [...group.options]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((o) => ({ id: o.id, name: o.name, price: o.price.amount, isDefault: o.isDefault, isActive: o.isActive }))
      : [{ name: {}, price: 0, isDefault: false, isActive: true }],
  };
}

/** Опции — полный список в порядке формы (порядок → sortOrder 10, 20, 30...). */
export function formToModifierGroupInput(values: ModifierGroupFormValues): ModifierGroupInput {
  return {
    code: emptyToNull(values.code?.toLowerCase()),
    name: cleanTranslatable(values.name),
    description: cleanTranslatable(values.description),
    minSelect: values.minSelect,
    maxSelect: values.maxSelect,
    isActive: values.isActive,
    options: values.options.map((o, index) => ({
      ...(o.id ? { id: o.id } : {}),
      name: cleanTranslatable(o.name),
      price: { amount: o.price ?? 0, currency: 'KZT' as const },
      isDefault: o.isDefault,
      sortOrder: (index + 1) * 10,
      isActive: o.isActive,
    })),
  };
}

export type ModifierGroupIssue = 'min_greater_than_max' | 'no_options' | 'min_exceeds_options' | 'too_many_defaults' | 'option_name_required';

/**
 * Подсказки формы до отправки — те же правила, что validateModifierGroupConfig на сервере
 * (сервер проверяет всё равно; ответ с details.reason показывается тем же текстом).
 */
export function modifierGroupIssues(values: Pick<ModifierGroupFormValues, 'minSelect' | 'maxSelect' | 'options'>): ModifierGroupIssue[] {
  const issues: ModifierGroupIssue[] = [];
  const active = values.options.filter((o) => o.isActive);
  if (values.minSelect > values.maxSelect) issues.push('min_greater_than_max');
  if (active.length === 0) issues.push('no_options');
  else if (values.minSelect > active.length) issues.push('min_exceeds_options');
  if (active.filter((o) => o.isDefault).length > values.maxSelect) issues.push('too_many_defaults');
  if (values.options.some((o) => !o.name?.kk?.trim() && !o.name?.ru?.trim())) issues.push('option_name_required');
  return issues;
}

/**
 * Отметка «по умолчанию»: при максимуме выбора 1 опция по умолчанию может быть только одна —
 * отметка другой снимает предыдущую (удобство ввода; правило проверяет сервер).
 */
export function toggleDefaultOption(options: readonly ModifierOptionFormValues[], index: number, checked: boolean, maxSelect: number): ModifierOptionFormValues[] {
  return options.map((o, i) => {
    if (i === index) return { ...o, isDefault: checked };
    if (checked && maxSelect === 1) return { ...o, isDefault: false };
    return o;
  });
}
