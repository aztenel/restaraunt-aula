import { Money } from '../../../shared/kernel/money';
import { OpeningHours, Weekday, WEEKDAYS } from '../../../shared/kernel/time';
import { Locale, translate, Translatable } from '../../../shared/kernel/translatable';

/**
 * SEO витрины: уникальные title и description, микроразметка schema.org (Menu, MenuItem).
 * Всё считается на сервере — фронт только вставляет готовые строки и JSON-LD.
 */
export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 160;

/** Обрезка по границе слова с многоточием. */
export function truncateText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/u, '')}…`;
}

export interface SeoInput {
  seoTitle: Translatable | null | undefined;
  seoDescription: Translatable | null | undefined;
  /** Название сущности — запасной заголовок. */
  name: Translatable;
  /** Запасные описания по приоритету (описание, состав). */
  fallbackDescriptions: Array<Translatable | string | null | undefined>;
  /** Добавка к заголовку по умолчанию: «— AULA GreenLine Aqua». */
  titleSuffix?: string | null;
}

export interface SeoMeta {
  title: string;
  description: string;
}

export function buildSeo(input: SeoInput, locale: Locale): SeoMeta {
  const explicitTitle = translate(input.seoTitle, locale);
  const name = translate(input.name, locale);
  const title = explicitTitle || (input.titleSuffix ? `${name} — ${input.titleSuffix}` : name);
  let description = translate(input.seoDescription, locale);
  if (!description) {
    for (const candidate of input.fallbackDescriptions) {
      const text = typeof candidate === 'string' ? candidate : translate(candidate, locale);
      if (text) {
        description = text;
        break;
      }
    }
  }
  return {
    title: truncateText(title, SEO_TITLE_MAX),
    description: truncateText(description || name, SEO_DESCRIPTION_MAX),
  };
}

/** Цена для schema.org: десятичная строка из тиынов без float ('2500.00'). */
export function decimalPrice(money: Money): string {
  const abs = Math.abs(money.amount);
  const major = Math.trunc(abs / 100);
  const minor = abs % 100;
  return `${money.amount < 0 ? '-' : ''}${major}.${String(minor).padStart(2, '0')}`;
}

export interface MenuItemLd {
  name: string;
  description: string;
  url: string | null;
  image: string | null;
  price: Money;
  available: boolean;
  isVegetarian: boolean;
  isHalal: boolean;
  calories: number | null;
  weightGrams: number | null;
}

/** schema.org MenuItem. */
export function menuItemJsonLd(item: MenuItemLd): Record<string, unknown> {
  const diets: string[] = [];
  if (item.isHalal) diets.push('https://schema.org/HalalDiet');
  if (item.isVegetarian) diets.push('https://schema.org/VegetarianDiet');
  const ld: Record<string, unknown> = {
    '@type': 'MenuItem',
    name: item.name,
    offers: {
      '@type': 'Offer',
      price: decimalPrice(item.price),
      priceCurrency: item.price.currency,
      availability: item.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
    },
  };
  if (item.description) ld.description = item.description;
  if (item.url) ld.url = item.url;
  if (item.image) ld.image = item.image;
  if (diets.length > 0) ld.suitableForDiet = diets;
  if (item.calories !== null || item.weightGrams !== null) {
    ld.nutrition = {
      '@type': 'NutritionInformation',
      ...(item.calories !== null ? { calories: `${item.calories} calories` } : {}),
      ...(item.weightGrams !== null ? { servingSize: `${item.weightGrams} g` } : {}),
    };
  }
  return ld;
}

/** schema.org Menu с разделами (категориями) — для страницы меню филиала. */
export function menuJsonLd(input: {
  name: string;
  locale: Locale;
  url: string | null;
  sections: Array<{ name: string; description: string; items: MenuItemLd[] }>;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    name: input.name,
    inLanguage: input.locale,
    ...(input.url ? { url: input.url } : {}),
    hasMenuSection: input.sections.map((s) => ({
      '@type': 'MenuSection',
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      hasMenuItem: s.items.map(menuItemJsonLd),
    })),
  };
}

const SCHEMA_DAYS: Record<Weekday, string> = {
  mon: 'https://schema.org/Monday',
  tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday',
  fri: 'https://schema.org/Friday',
  sat: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday',
};

/** Кухня сети для микроразметки Restaurant. */
export const SERVES_CUISINE: Record<Locale, string[]> = {
  ru: ['Казахская', 'Европейская', 'Халал'],
  kk: ['Қазақ', 'Еуропа', 'Халал'],
  en: ['Kazakh', 'European', 'Halal'],
};

export interface RestaurantLd {
  name: string;
  locale: Locale;
  telephone: string;
  /** Адрес филиала одной строкой: «Астана, ул. Е-899, 1/1» (город — до первой запятой). */
  address: string;
  lat: number;
  lng: number;
  openingHours: OpeningHours;
  acceptsReservations: boolean;
  priceRange?: string | null;
  menu?: Record<string, unknown> | null;
}

/** «Астана, ул. Е-899, 1/1» -> город и улица (город — первая часть до запятой, если частей больше одной). */
export function splitAddress(address: string): { locality: string | null; street: string } {
  const parts = address.split(',').map((p) => p.trim());
  if (parts.length < 2 || !parts[0]) return { locality: null, street: address.trim() };
  return { locality: parts[0], street: parts.slice(1).join(', ') };
}

/** schema.org Restaurant (страница филиала / меню филиала): адрес, координаты, часы, кухня, меню. */
export function restaurantJsonLd(input: RestaurantLd): Record<string, unknown> {
  const hours = WEEKDAYS.flatMap((day) =>
    (input.openingHours[day] ?? []).map((interval) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAYS[day],
      opens: interval.open,
      closes: interval.close,
    })),
  );
  const { ['@context']: _ctx, ...menu } = input.menu ?? {};
  const { locality, street } = splitAddress(input.address);
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name: input.name,
    telephone: input.telephone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: street,
      ...(locality ? { addressLocality: locality } : {}),
      addressCountry: 'KZ',
    },
    geo: { '@type': 'GeoCoordinates', latitude: input.lat, longitude: input.lng },
    servesCuisine: SERVES_CUISINE[input.locale],
    acceptsReservations: input.acceptsReservations,
    currenciesAccepted: 'KZT',
    ...(input.priceRange ? { priceRange: input.priceRange } : {}),
    ...(hours.length > 0 ? { openingHoursSpecification: hours } : {}),
    ...(input.menu ? { hasMenu: menu } : {}),
  };
}

/** Диапазон цен для Restaurant.priceRange: '1 900–12 900 KZT' (без float). */
export function priceRange(prices: readonly Money[]): string | null {
  if (prices.length === 0) return null;
  const amounts = prices.map((p) => p.amount);
  const fmt = (tiyn: number) => String(Math.trunc(tiyn / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${fmt(Math.min(...amounts))}–${fmt(Math.max(...amounts))} KZT`;
}
