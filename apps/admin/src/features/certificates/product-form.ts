/**
 * Продукт сертификата (certificates.manage): форма ⇄ CertificateProductInputDto.
 * Правила — зеркало toWrite() на сервере: slug, название kk/ru (хотя бы одно), для набора — описание
 * состава, номинал > 0, цена ≥ 0, срок 1–60 месяцев, цвет #RRGGBB.
 */
import type { Translatable } from '@aula/api-client';
import type { CertificateKind, CertificateProduct, CertificateProductInput } from './types';

export const PRODUCT_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const PRODUCT_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const DEFAULT_PRODUCT_COLOR = '#7a4b2a';
export const DEFAULT_PRODUCT_THEME = 'classic';
export const DEFAULT_VALIDITY_MONTHS = 12;

export interface ProductFormValues {
  slug: string;
  kind: CertificateKind;
  name: Translatable;
  description: Translatable;
  /** Тиыны. */
  nominal: number | null;
  /** Тиыны. */
  price: number | null;
  validityMonths: number | null;
  color: string;
  theme: string;
  imageUrl: string;
  isActive: boolean;
  sortOrder: number | null;
}

export type ProductFormIssue =
  | 'slug_format'
  | 'name_required'
  | 'description_required'
  | 'nominal_required'
  | 'nominal_positive'
  | 'price_required'
  | 'price_negative'
  | 'validity_range'
  | 'color_format';

export type ProductFormErrors = Partial<Record<'slug' | 'name' | 'description' | 'nominal' | 'price' | 'validityMonths' | 'color', ProductFormIssue>>;

export function emptyProductForm(): ProductFormValues {
  return {
    slug: '',
    kind: 'amount',
    name: {},
    description: {},
    nominal: null,
    price: null,
    validityMonths: DEFAULT_VALIDITY_MONTHS,
    color: DEFAULT_PRODUCT_COLOR,
    theme: DEFAULT_PRODUCT_THEME,
    imageUrl: '',
    isActive: true,
    sortOrder: 0,
  };
}

export function productToForm(product: CertificateProduct): ProductFormValues {
  return {
    slug: product.slug,
    kind: product.kind,
    name: { ...product.name },
    description: { ...product.description },
    nominal: product.nominal.amount,
    price: product.price.amount,
    validityMonths: product.validityMonths,
    color: product.design.color,
    theme: product.design.theme,
    imageUrl: product.design.imageUrl ?? '',
    isActive: product.isActive,
    sortOrder: product.sortOrder,
  };
}

function filled(value: Translatable | null | undefined): boolean {
  return Boolean(value?.kk?.trim() || value?.ru?.trim());
}

export function validateProductForm(values: ProductFormValues): ProductFormErrors {
  const errors: ProductFormErrors = {};
  if (!PRODUCT_SLUG_RE.test(values.slug.trim().toLowerCase()) || values.slug.trim().length > 80) errors.slug = 'slug_format';
  if (!filled(values.name)) errors.name = 'name_required';
  if (values.kind === 'set' && !filled(values.description)) errors.description = 'description_required';
  if (values.nominal === null || values.nominal === undefined) errors.nominal = 'nominal_required';
  else if (values.nominal <= 0) errors.nominal = 'nominal_positive';
  if (values.price === null || values.price === undefined) errors.price = 'price_required';
  else if (values.price < 0) errors.price = 'price_negative';
  const months = values.validityMonths;
  if (months === null || months === undefined || !Number.isInteger(months) || months < 1 || months > 60) errors.validityMonths = 'validity_range';
  if (!PRODUCT_COLOR_RE.test(values.color)) errors.color = 'color_format';
  return errors;
}

function cleanTranslatable(value: Translatable): Translatable {
  const result: Translatable = {};
  for (const locale of ['kk', 'ru', 'en'] as const) {
    const text = value[locale]?.trim();
    if (text) result[locale] = text;
  }
  return result;
}

export function toProductInput(values: ProductFormValues): CertificateProductInput {
  return {
    slug: values.slug.trim().toLowerCase(),
    kind: values.kind,
    name: cleanTranslatable(values.name),
    description: cleanTranslatable(values.description),
    nominal: { amount: values.nominal ?? 0, currency: 'KZT' },
    price: { amount: values.price ?? 0, currency: 'KZT' },
    validityMonths: values.validityMonths ?? DEFAULT_VALIDITY_MONTHS,
    design: { color: values.color, theme: values.theme.trim() || DEFAULT_PRODUCT_THEME, imageUrl: values.imageUrl.trim() || null },
    isActive: values.isActive,
    sortOrder: values.sortOrder ?? 0,
  };
}

/** Продукт как есть с другим признаком активности (снять с продажи / вернуть). */
export function productWithActive(product: CertificateProduct, isActive: boolean): CertificateProductInput {
  return toProductInput({ ...productToForm(product), isActive });
}
