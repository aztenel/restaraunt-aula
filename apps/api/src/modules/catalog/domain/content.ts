import { ValidationError } from '../../../shared/kernel/errors';
import { Translatable } from '../../../shared/kernel/translatable';

/**
 * Контент витрины: баннеры, акции, статические страницы. Ведёт контент-менеджер.
 */
export const BannerPlacement = {
  HomeHero: 'home_hero',
  HomeSecondary: 'home_secondary',
  MenuTop: 'menu_top',
} as const;
export type BannerPlacement = (typeof BannerPlacement)[keyof typeof BannerPlacement];
export const BANNER_PLACEMENTS = Object.values(BannerPlacement);

export function isBannerPlacement(value: unknown): value is BannerPlacement {
  return typeof value === 'string' && (BANNER_PLACEMENTS as string[]).includes(value);
}

export const CONTENT_TEXT_LIMITS = {
  title: 200,
  subtitle: 400,
  ctaLabel: 60,
  promotionDescription: 5000,
  promotionTerms: 5000,
  pageTitle: 200,
  pageBody: 200_000,
  seoTitle: 120,
  seoDescription: 320,
} as const;

/**
 * Стандартные страницы витрины. Оферта и политика конфиденциальности обязательны юридически
 * (на них ссылается согласие на обработку персональных данных) — их нельзя удалить или снять с публикации.
 */
export const STANDARD_PAGES = ['about', 'delivery', 'payment', 'offer', 'privacy', 'contacts'] as const;
export const PROTECTED_PAGES: readonly string[] = ['offer', 'privacy'];

export function isProtectedPage(slug: string): boolean {
  return PROTECTED_PAGES.includes(slug);
}

/** Ссылка баннера: относительный путь витрины ('/menu/...') или https/http URL. Никаких javascript:. */
export function normalizeLink(value: string | null | undefined): string | null {
  const link = value?.trim() ?? '';
  if (!link) return null;
  if (link.length > 1000) throw new ValidationError('content.invalid_link', 'Link is too long');
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
  } catch {
    // ниже — общая ошибка
  }
  throw new ValidationError('content.invalid_link', 'Link must be a site path (/...) or an http(s) URL', { link });
}

/** Окно активности [from, to): to строго позже from. */
export function validateWindow(from: Date | null, to: Date | null, code = 'content.invalid_period'): void {
  if (from && Number.isNaN(from.getTime())) throw new ValidationError(code, 'Invalid start date');
  if (to && Number.isNaN(to.getTime())) throw new ValidationError(code, 'Invalid end date');
  if (from && to && to.getTime() <= from.getTime()) {
    throw new ValidationError(code, 'End must be after start', { from: from.toISOString(), to: to.toISOString() });
  }
}

export function isWithinWindow(from: Date | null, to: Date | null, now: Date): boolean {
  return (!from || from.getTime() <= now.getTime()) && (!to || now.getTime() < to.getTime());
}

export interface BannerVisibility {
  isActive: boolean;
  branchId: string | null;
  activeFrom: Date | null;
  activeTo: Date | null;
}

/** Баннер виден на витрине: включён, в окне активности, глобальный или для этого филиала. */
export function isBannerVisible(banner: BannerVisibility, now: Date, branchId: string | null): boolean {
  if (!banner.isActive || !isWithinWindow(banner.activeFrom, banner.activeTo, now)) return false;
  return banner.branchId === null || banner.branchId === branchId;
}

export interface PromotionVisibility {
  isActive: boolean;
  branchIds: string[];
  validFrom: Date | null;
  validTo: Date | null;
}

/** Акция видна: включена, действует сейчас, во всех филиалах (пустой список) или в выбранном. */
export function isPromotionVisible(promotion: PromotionVisibility, now: Date, branchId: string | null): boolean {
  if (!promotion.isActive || !isWithinWindow(promotion.validFrom, promotion.validTo, now)) return false;
  if (promotion.branchIds.length === 0 || branchId === null) return true;
  return promotion.branchIds.includes(branchId);
}

/** Для заголовков карточек: поле обязательно хотя бы на одном из основных языков. */
export type ContentText = Translatable;
