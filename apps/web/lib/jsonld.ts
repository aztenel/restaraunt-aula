/**
 * Микроразметка schema.org (JSON-LD): Restaurant по каждому филиалу, Menu/MenuSection/MenuItem,
 * BreadcrumbList, Organization/WebSite. Цены в Offer — в тенге (тиыны / 100) строкой, без float.
 */
import {
  formatFixed2ForInput,
  translate,
  WEEKDAYS,
  type Money,
  type OpeningHours,
  type PublicBranch,
  type Weekday,
} from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import type { BranchMenu, Category, DishCard, DishDetail } from './api-types';
import { largestVariantUrl } from './images';
import { routes } from './routes';
import { localizedUrl, SITE_NAME } from './seo';

type JsonLd = Record<string, unknown>;

const SCHEMA_DAY: Record<Weekday, string> = {
  mon: 'https://schema.org/Monday',
  tue: 'https://schema.org/Tuesday',
  wed: 'https://schema.org/Wednesday',
  thu: 'https://schema.org/Thursday',
  fri: 'https://schema.org/Friday',
  sat: 'https://schema.org/Saturday',
  sun: 'https://schema.org/Sunday',
};

const CUISINE: Record<AppLocale, string[]> = {
  kk: ['Қазақ асханасы', 'Kazakh'],
  ru: ['Казахская кухня', 'Kazakh'],
  en: ['Kazakh', 'Central Asian'],
};

export interface OpeningHoursSpecification {
  '@type': 'OpeningHoursSpecification';
  dayOfWeek: string[];
  opens: string;
  closes: string;
}

/**
 * Часы работы филиала → openingHoursSpecification.
 * Дни с одинаковым интервалом объединяются; закрытые дни не выводятся. Интервал через полночь
 * (close <= open, например 10:00–02:00) передаётся как есть — так его понимает schema.org/Google.
 */
export function openingHoursSpecification(hours: OpeningHours | null | undefined): OpeningHoursSpecification[] {
  if (!hours) return [];
  const groups = new Map<string, OpeningHoursSpecification>();
  for (const day of WEEKDAYS) {
    for (const interval of hours[day] ?? []) {
      if (!interval?.open || !interval?.close) continue;
      const key = `${interval.open}-${interval.close}`;
      const existing = groups.get(key);
      if (existing) existing.dayOfWeek.push(SCHEMA_DAY[day]);
      else
        groups.set(key, {
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: [SCHEMA_DAY[day]],
          opens: interval.open,
          closes: interval.close,
        });
    }
  }
  return [...groups.values()];
}

/** Цена для Offer: 250000 тиынов → "2500", 250050 → "2500.50". */
export function offerPrice(money: Money): string {
  return formatFixed2ForInput(money.amount, 'en');
}

export interface RestaurantJsonLdInput {
  branch: PublicBranch;
  locale: AppLocale;
  /** Абсолютный URL страницы филиала. */
  url: string;
  /** Абсолютный URL меню филиала. */
  menuUrl: string;
  images?: string[];
}

export function restaurantJsonLd({ branch, locale, url, menuUrl, images }: RestaurantJsonLdInput): JsonLd {
  const name = translate(branch.name, locale);
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${url}#restaurant`,
    name,
    url,
    ...(images?.length ? { image: images } : {}),
    telephone: branch.phone,
    address: {
      '@type': 'PostalAddress',
      streetAddress: translate(branch.address, locale),
      addressCountry: 'KZ',
    },
    geo: {
      '@type': 'GeoCoordinates',
      latitude: branch.location.lat,
      longitude: branch.location.lng,
    },
    openingHoursSpecification: openingHoursSpecification(branch.openingHours),
    servesCuisine: CUISINE[locale],
    priceRange: '₸₸',
    currenciesAccepted: 'KZT',
    acceptsReservations: branch.acceptsReservations,
    hasMenu: menuUrl,
    brand: { '@type': 'Brand', name: SITE_NAME },
  };
}

export interface JsonLdMenuItem {
  name: string;
  description?: string | null;
  url?: string;
  image?: string | null;
  /** Цена филиала от сервера; null — цены нет (блюдо недоступно). */
  price: Money | null;
  available?: boolean;
  /** schema.org RestrictedDiet: 'https://schema.org/HalalDiet', 'https://schema.org/VegetarianDiet'. */
  suitableForDiet?: string[];
  weightGrams?: number | null;
  /** ккал на порцию. */
  calories?: number | null;
}

export interface JsonLdMenuSection {
  name: string;
  description?: string | null;
  url?: string;
  items: JsonLdMenuItem[];
}

export interface MenuJsonLdInput {
  name: string;
  url: string;
  locale: AppLocale;
  sections: JsonLdMenuSection[];
}

export function menuItemJsonLd(item: JsonLdMenuItem): JsonLd {
  return {
    '@type': 'MenuItem',
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    ...(item.url ? { url: item.url } : {}),
    ...(item.image ? { image: item.image } : {}),
    ...(item.suitableForDiet?.length ? { suitableForDiet: item.suitableForDiet } : {}),
    ...(item.weightGrams ? { weight: { '@type': 'QuantitativeValue', value: item.weightGrams, unitCode: 'GRM' } } : {}),
    ...(item.calories ? { nutrition: { '@type': 'NutritionInformation', calories: `${item.calories} calories` } } : {}),
    ...(item.price
      ? {
          offers: {
            '@type': 'Offer',
            price: offerPrice(item.price),
            priceCurrency: item.price.currency,
            availability:
              item.available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock',
          },
        }
      : {}),
  };
}

export function menuJsonLd({ name, url, locale, sections }: MenuJsonLdInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Menu',
    '@id': `${url}#menu`,
    name,
    url,
    inLanguage: locale,
    hasMenuSection: sections.map((section) => ({
      '@type': 'MenuSection',
      name: section.name,
      ...(section.description ? { description: section.description } : {}),
      ...(section.url ? { url: section.url } : {}),
      hasMenuItem: section.items.map(menuItemJsonLd),
    })),
  };
}

// ---------------------------------------------------------------- Меню филиала из ответа API

const DIET = {
  vegetarian: 'https://schema.org/VegetarianDiet',
  halal: 'https://schema.org/HalalDiet',
} as const;

/** Диеты schema.org по признакам блюда. */
export function dishDiets(dish: Pick<DishCard, 'isVegetarian' | 'isHalal'>): string[] {
  return [...(dish.isVegetarian ? [DIET.vegetarian] : []), ...(dish.isHalal ? [DIET.halal] : [])];
}

/** Блюдо (карточка API) → MenuItem: цена и доступность филиала, фото, вес, диеты, ссылка на страницу блюда. */
export function dishToMenuItem(dish: DishCard, url: string): JsonLdMenuItem {
  return {
    name: dish.name,
    description: dish.description || null,
    url,
    image: dish.photo ? largestVariantUrl(dish.photo) : null,
    price: dish.price,
    available: dish.available,
    suitableForDiet: dishDiets(dish),
    weightGrams: dish.weightGrams,
    calories: dish.calories,
  };
}

export interface MenuUrls {
  locale: AppLocale;
  branchSlug: string;
  siteUrl: string;
}

function dishUrl(dish: Pick<DishCard, 'slug' | 'categorySlug'>, urls: MenuUrls): string {
  return localizedUrl(urls.locale, routes.dish(urls.branchSlug, dish.categorySlug, dish.slug), urls.siteUrl);
}

function sectionOf(category: Pick<Category, 'name' | 'description' | 'slug'>, dishes: DishCard[], urls: MenuUrls): JsonLdMenuSection {
  return {
    name: category.name,
    description: category.description || null,
    url: localizedUrl(urls.locale, routes.category(urls.branchSlug, category.slug), urls.siteUrl),
    items: dishes.map((dish) => dishToMenuItem(dish, dishUrl(dish, urls))),
  };
}

/** Menu филиала: разделы (категории) со ссылками на страницы категорий и блюд. */
export function branchMenuJsonLd(menu: Pick<BranchMenu, 'categories'>, input: MenuUrls & { name: string }): JsonLd {
  return menuJsonLd({
    name: input.name,
    url: localizedUrl(input.locale, routes.branchMenu(input.branchSlug), input.siteUrl),
    locale: input.locale,
    sections: menu.categories.map((category) => sectionOf(category, category.dishes, input)),
  });
}

/** Menu с одним разделом — страница категории. */
export function categoryMenuJsonLd(
  category: Pick<Category, 'name' | 'description' | 'slug'>,
  dishes: DishCard[],
  input: MenuUrls & { name: string },
): JsonLd {
  const url = localizedUrl(input.locale, routes.category(input.branchSlug, category.slug), input.siteUrl);
  return menuJsonLd({ name: input.name, url, locale: input.locale, sections: [sectionOf(category, dishes, input)] });
}

/** MenuItem страницы блюда (все фото, состав). */
export function dishJsonLd(dish: DishDetail, input: MenuUrls): JsonLd {
  const url = dishUrl(dish, input);
  const images = dish.photos.map(largestVariantUrl);
  const item = menuItemJsonLd(dishToMenuItem(dish, url));
  return {
    '@context': 'https://schema.org',
    ...item,
    '@id': `${url}#dish`,
    ...(images.length > 0 ? { image: images } : {}),
    ...(dish.composition ? { description: [dish.description, dish.composition].filter(Boolean).join('. ') } : {}),
    inLanguage: input.locale,
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function organizationJsonLd(input: { url: string; logo: string; legalName?: string; telephone?: string }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: input.url,
    logo: input.logo,
    ...(input.legalName ? { legalName: input.legalName } : {}),
    ...(input.telephone ? { telephone: input.telephone } : {}),
  };
}

export function websiteJsonLd(input: { url: string; locale: AppLocale }): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: input.url,
    inLanguage: input.locale,
  };
}

/** Безопасная сериализация для <script type="application/ld+json"> (защита от </script> в данных). */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
