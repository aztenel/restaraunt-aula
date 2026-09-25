/**
 * SEO-инфраструктура витрины: уникальные title/description, canonical, hreflang-альтернативы
 * (kk/ru/en + x-default), OpenGraph. Все страницы строят метаданные через buildMetadata.
 */
import type { Metadata } from 'next';
import { routing, type AppLocale } from '@/i18n/routing';
import { getSiteUrl } from './config';

export const SITE_NAME = 'AULA';

const OG_LOCALE: Record<AppLocale, string> = {
  kk: 'kk_KZ',
  ru: 'ru_RU',
  en: 'en_US',
};

/** Нормализует путь без префикса языка: '' → '/', 'menu/' → '/menu'. */
export function normalizePath(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : '/';
}

/** Абсолютный URL страницы на языке: ('ru', '/branches') → https://aula.kz/ru/branches. */
export function localizedUrl(locale: AppLocale, path: string, siteUrl: string = getSiteUrl()): string {
  const normalized = normalizePath(path);
  return `${siteUrl}/${locale}${normalized === '/' ? '' : normalized}`;
}

/** hreflang-альтернативы для всех языков + x-default (язык по умолчанию). */
export function languageAlternates(path: string, siteUrl: string = getSiteUrl()): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of routing.locales) {
    languages[locale] = localizedUrl(locale, path, siteUrl);
  }
  languages['x-default'] = localizedUrl(routing.defaultLocale, path, siteUrl);
  return languages;
}

export interface MetadataImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface BuildMetadataInput {
  locale: AppLocale;
  /** Путь без префикса языка: '/', '/branches/greenline'. */
  path: string;
  title: string;
  description: string;
  images?: MetadataImage[];
  /** Служебные страницы (статус заказа, оплата, токены) — не индексировать. */
  noindex?: boolean;
  /** Вместе с noindex: переходить по ссылкам страницы (результаты поиска/фильтров меню). */
  follow?: boolean;
  type?: 'website' | 'article';
  /** Заголовок без шаблона «%s — AULA». По умолчанию — если название бренда уже есть в заголовке. */
  absoluteTitle?: boolean;
  siteUrl?: string;
}

export function buildMetadata(input: BuildMetadataInput): Metadata {
  const siteUrl = input.siteUrl ?? getSiteUrl();
  const url = localizedUrl(input.locale, input.path, siteUrl);
  const description = truncateDescription(input.description);
  const absolute = input.absoluteTitle ?? input.title.includes(SITE_NAME);
  return {
    title: absolute ? { absolute: input.title } : input.title,
    description,
    alternates: {
      canonical: url,
      languages: languageAlternates(input.path, siteUrl),
    },
    openGraph: {
      type: input.type ?? 'website',
      url,
      title: input.title,
      description,
      siteName: SITE_NAME,
      locale: OG_LOCALE[input.locale],
      alternateLocale: routing.locales.filter((l) => l !== input.locale).map((l) => OG_LOCALE[l]),
      images: input.images,
    },
    twitter: {
      card: input.images?.length ? 'summary_large_image' : 'summary',
      title: input.title,
      description,
    },
    robots: input.noindex ? { index: false, follow: input.follow ?? false } : undefined,
  };
}

/** description для сниппета — до ~160 символов, по границе слова. */
export function truncateDescription(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,.;:\s]+$/, '')}…`;
}
