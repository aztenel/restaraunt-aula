/**
 * Формы контента витрины ⇄ DTO API: баннеры, акции, страницы. Даты окна показа — ISO UTC
 * (в форме — стенные часы Asia/Almaty), пустые поля → null.
 */
import type { Dayjs } from 'dayjs';
import {
  LOCALES,
  type Banner,
  type BannerInput,
  type BannerPlacement,
  type ContentPage,
  type ContentPageInput,
  type Locale,
  type Promotion,
  type PromotionInput,
  type Translatable,
} from '@aula/api-client';
import { isoToPickerValue, pickerValueToIso } from '@/shared/lib/dates';
import { cleanTranslatable, emptyToNull, numberOrNull } from '../menu/forms';

export const BANNER_PLACEMENTS: readonly BannerPlacement[] = ['home_hero', 'home_secondary', 'menu_top'];

/** Ссылка баннера: путь витрины (/menu/...) или http(s)-адрес — как normalizeLink на сервере. */
export function isValidBannerLink(value: string | null | undefined): boolean {
  const link = value?.trim() ?? '';
  if (!link) return true;
  if (link.length > 1000) return false;
  if (link.startsWith('/')) return !link.startsWith('//');
  try {
    const url = new URL(link);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Окно показа [с, по): «по» строго позже «с» (как validateWindow на сервере). */
export function isValidWindow(from: Dayjs | null | undefined, to: Dayjs | null | undefined): boolean {
  return !from || !to || to.valueOf() > from.valueOf();
}

// ---------------------------------------------------------------- Баннер

export interface BannerFormValues {
  placement: BannerPlacement;
  /** null — для всех филиалов. */
  branchId: string | null;
  title: Translatable;
  subtitle: Translatable;
  ctaLabel: Translatable;
  linkUrl: string;
  activeFrom: Dayjs | null;
  activeTo: Dayjs | null;
  sortOrder: number | null;
  isActive: boolean;
}

export function bannerToForm(banner: Banner | null, defaults: { branchId?: string | null } = {}): BannerFormValues {
  return {
    placement: banner?.placement ?? 'home_hero',
    branchId: banner ? banner.branchId : (defaults.branchId ?? null),
    title: banner?.title ?? {},
    subtitle: banner?.subtitle ?? {},
    ctaLabel: banner?.ctaLabel ?? {},
    linkUrl: banner?.linkUrl ?? '',
    activeFrom: isoToPickerValue(banner?.activeFrom),
    activeTo: isoToPickerValue(banner?.activeTo),
    sortOrder: banner?.sortOrder ?? null,
    isActive: banner?.isActive ?? true,
  };
}

export function formToBannerInput(values: BannerFormValues): BannerInput {
  return {
    placement: values.placement,
    branchId: values.branchId ?? null,
    title: cleanTranslatable(values.title),
    subtitle: cleanTranslatable(values.subtitle),
    ctaLabel: cleanTranslatable(values.ctaLabel),
    linkUrl: emptyToNull(values.linkUrl),
    activeFrom: pickerValueToIso(values.activeFrom),
    activeTo: pickerValueToIso(values.activeTo),
    sortOrder: numberOrNull(values.sortOrder),
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- Акция

export interface PromotionFormValues {
  slug: string;
  title: Translatable;
  description: Translatable;
  terms: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  validFrom: Dayjs | null;
  validTo: Dayjs | null;
  /** Пусто — во всех филиалах. */
  branchIds: string[];
  sortOrder: number | null;
  isActive: boolean;
}

export function promotionToForm(promotion: Promotion | null, defaults: { branchIds?: string[] } = {}): PromotionFormValues {
  return {
    slug: promotion?.slug ?? '',
    title: promotion?.title ?? {},
    description: promotion?.description ?? {},
    terms: promotion?.terms ?? {},
    seoTitle: promotion?.seoTitle ?? {},
    seoDescription: promotion?.seoDescription ?? {},
    validFrom: isoToPickerValue(promotion?.validFrom),
    validTo: isoToPickerValue(promotion?.validTo),
    branchIds: promotion?.branchIds ?? defaults.branchIds ?? [],
    sortOrder: promotion?.sortOrder ?? null,
    isActive: promotion?.isActive ?? true,
  };
}

export function formToPromotionInput(values: PromotionFormValues): PromotionInput {
  return {
    slug: emptyToNull(values.slug?.toLowerCase()),
    title: cleanTranslatable(values.title),
    description: cleanTranslatable(values.description),
    terms: cleanTranslatable(values.terms),
    seoTitle: cleanTranslatable(values.seoTitle),
    seoDescription: cleanTranslatable(values.seoDescription),
    validFrom: pickerValueToIso(values.validFrom),
    validTo: pickerValueToIso(values.validTo),
    branchIds: [...new Set(values.branchIds ?? [])],
    sortOrder: numberOrNull(values.sortOrder),
    isActive: values.isActive,
  };
}

// ---------------------------------------------------------------- Страница

export interface PageFormValues {
  slug: string;
  title: Translatable;
  /** HTML по языкам (санитизирует сервер при сохранении). */
  body: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  isPublished: boolean;
  sortOrder: number | null;
}

export function pageToForm(page: ContentPage | null): PageFormValues {
  return {
    slug: page?.slug ?? '',
    title: page?.title ?? {},
    body: page?.body ?? {},
    seoTitle: page?.seoTitle ?? {},
    seoDescription: page?.seoDescription ?? {},
    isPublished: page?.isPublished ?? true,
    sortOrder: page?.sortOrder ?? null,
  };
}

export function formToPageInput(values: PageFormValues): ContentPageInput {
  return {
    slug: emptyToNull(values.slug?.toLowerCase()),
    title: cleanTranslatable(values.title),
    body: cleanTranslatable(values.body),
    seoTitle: cleanTranslatable(values.seoTitle),
    seoDescription: cleanTranslatable(values.seoDescription),
    isPublished: values.isPublished,
    sortOrder: numberOrNull(values.sortOrder),
  };
}

/** Языки, где сервер изменил разметку при санитизации (вырезал небезопасное) — показать предупреждение. */
export function sanitizedLocales(sent: Translatable, saved: Translatable): Locale[] {
  return LOCALES.filter((locale) => {
    const before = sent[locale]?.trim() ?? '';
    const after = saved[locale]?.trim() ?? '';
    return before !== '' && before !== after;
  });
}
