import { describe, expect, it } from 'vitest';
import type { BranchMenu, DishCard, DishDetail } from '@/lib/api-types';
import { branchMenuJsonLd, categoryMenuJsonLd, dishJsonLd, dishToMenuItem, serializeJsonLd } from '@/lib/jsonld';
import { buildSitemapEntries } from '@/lib/sitemap';

const SITE = 'https://aula.kz';
const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });
const image = (id: string) => ({
  id,
  url: `https://cdn.aula.kz/${id}-600.webp`,
  width: 600,
  height: 450,
  variants: [
    { width: 300, height: 225, url: `https://cdn.aula.kz/${id}-300.webp` },
    { width: 1200, height: 900, url: `https://cdn.aula.kz/${id}-1200.webp` },
    { width: 600, height: 450, url: `https://cdn.aula.kz/${id}-600.webp` },
  ],
});

function dish(overrides: Partial<DishCard> = {}): DishCard {
  return {
    id: 'd1',
    slug: 'beshbarmak',
    categoryId: 'c1',
    categorySlug: 'kazakhskaya-kukhnya',
    name: 'Бешбармак',
    description: 'Отварное мясо с тестом',
    price: kzt(450050),
    available: true,
    availability: 'available',
    weightGrams: 450,
    calories: 780,
    isVegetarian: false,
    spicyLevel: 0,
    isHalal: true,
    allergens: [],
    photo: image('p1'),
    hasModifiers: false,
    hasRequiredModifiers: false,
    updatedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  };
}

const category = {
  id: 'c1',
  slug: 'kazakhskaya-kukhnya',
  name: 'Казахская кухня',
  description: 'Национальные блюда',
  image: null,
  seo: { title: 'Казахская кухня — AULA GreenLine Aqua', description: 'Национальные блюда' },
  dishCount: 2,
  updatedAt: '2026-09-20T10:00:00.000Z',
};

const urls = { locale: 'ru' as const, branchSlug: 'greenline', siteUrl: SITE };

describe('JSON-LD меню из ответа API', () => {
  it('блюдо → MenuItem: цена в тенге строкой, доступность, диеты, самое крупное фото, вес и калории', () => {
    const item = dishToMenuItem(dish(), `${SITE}/ru/greenline/menu/kazakhskaya-kukhnya/beshbarmak`);
    expect(item).toMatchObject({
      name: 'Бешбармак',
      image: 'https://cdn.aula.kz/p1-1200.webp',
      suitableForDiet: ['https://schema.org/HalalDiet'],
      weightGrams: 450,
      calories: 780,
      available: true,
    });
    const vegetarian = dishToMenuItem(dish({ isVegetarian: true, isHalal: false, photo: null }), 'u');
    expect(vegetarian.suitableForDiet).toEqual(['https://schema.org/VegetarianDiet']);
    expect(vegetarian.image).toBeNull();
  });

  it('Menu филиала: разделы со ссылками на категории, блюда со ссылками и Offer в KZT', () => {
    const menu: Pick<BranchMenu, 'categories'> = {
      categories: [{ ...category, dishes: [dish(), dish({ id: 'd2', slug: 'kazy', name: 'Казы', available: false, availability: 'stopped_shown', price: kzt(300000) })] }],
    };
    const data = branchMenuJsonLd(menu, { ...urls, name: 'Меню AULA GreenLine Aqua' });
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Menu',
      '@id': `${SITE}/ru/greenline/menu#menu`,
      url: `${SITE}/ru/greenline/menu`,
      inLanguage: 'ru',
    });
    const section = (data.hasMenuSection as Array<Record<string, unknown>>)[0]!;
    expect(section).toMatchObject({ '@type': 'MenuSection', name: 'Казахская кухня', url: `${SITE}/ru/greenline/menu/kazakhskaya-kukhnya` });
    const items = section.hasMenuItem as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      '@type': 'MenuItem',
      url: `${SITE}/ru/greenline/menu/kazakhskaya-kukhnya/beshbarmak`,
      offers: { '@type': 'Offer', price: '4500.50', priceCurrency: 'KZT', availability: 'https://schema.org/InStock' },
      weight: { '@type': 'QuantitativeValue', value: 450, unitCode: 'GRM' },
      nutrition: { '@type': 'NutritionInformation', calories: '780 calories' },
    });
    expect((items[1]!.offers as Record<string, string>).availability).toBe('https://schema.org/OutOfStock');
  });

  it('страница категории — Menu с одним разделом', () => {
    const data = categoryMenuJsonLd(category, [dish()], { ...urls, locale: 'kk', name: category.seo.title });
    expect(data.url).toBe(`${SITE}/kk/greenline/menu/kazakhskaya-kukhnya`);
    expect((data.hasMenuSection as unknown[]).length).toBe(1);
  });

  it('страница блюда — MenuItem с @context, всеми фото и составом', () => {
    const detail: DishDetail = {
      ...dish(),
      composition: 'Конина, баранина, тесто, лук',
      photos: [image('p1'), image('p2')],
      modifierGroups: [],
      category: { id: 'c1', slug: 'kazakhskaya-kukhnya', name: 'Казахская кухня' },
      branch: { id: 'b1', slug: 'greenline', name: 'AULA GreenLine Aqua' },
      seo: { title: 'Бешбармак — AULA GreenLine Aqua', description: '…' },
      structuredData: {},
    };
    const data = dishJsonLd(detail, urls);
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'MenuItem',
      '@id': `${SITE}/ru/greenline/menu/kazakhskaya-kukhnya/beshbarmak#dish`,
      image: ['https://cdn.aula.kz/p1-1200.webp', 'https://cdn.aula.kz/p2-1200.webp'],
      description: 'Отварное мясо с тестом. Конина, баранина, тесто, лук',
    });
    // Безопасно встраивается в <script>.
    expect(serializeJsonLd(data)).not.toContain('</');
  });
});

describe('карта сайта: акции и текст согласия', () => {
  it('включает список акций, страницы акций и согласие на всех языках с hreflang', () => {
    const entries = buildSitemapEntries({
      siteUrl: SITE,
      branches: [],
      catalog: { promotions: [{ slug: 'sezon-kumysa', updatedAt: '2026-09-01T00:00:00Z' }], pages: [{ slug: 'offer' }] },
    });
    const urls = entries.map((e) => e.url);
    expect(urls).toContain(`${SITE}/ru/promotions`);
    expect(urls).toContain(`${SITE}/kk/promotions/sezon-kumysa`);
    expect(urls).toContain(`${SITE}/en/consents/personal-data`);
    expect(urls).toContain(`${SITE}/ru/pages/offer`);
    const promo = entries.find((e) => e.url === `${SITE}/ru/promotions/sezon-kumysa`)!;
    expect(promo.alternates?.languages).toMatchObject({
      kk: `${SITE}/kk/promotions/sezon-kumysa`,
      'x-default': `${SITE}/ru/promotions/sezon-kumysa`,
    });
    expect(promo.lastModified).toEqual(new Date('2026-09-01T00:00:00Z'));
  });
});
