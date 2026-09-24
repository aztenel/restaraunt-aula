import { describe, expect, it } from 'vitest';
import type { PublicBranch } from '@aula/api-client';
import {
  menuJsonLd,
  offerPrice,
  openingHoursSpecification,
  restaurantJsonLd,
  serializeJsonLd,
} from '@/lib/jsonld';
import { buildMetadata, languageAlternates, localizedUrl, normalizePath, truncateDescription } from '@/lib/seo';
import { buildSitemapEntries } from '@/lib/sitemap';
import { switchBranchInPath } from '@/lib/routes';

const SITE = 'https://aula.kz';

const branch: PublicBranch = {
  id: 'b1',
  slug: 'greenline',
  name: { ru: 'AULA GreenLine Aqua', kk: 'AULA GreenLine Aqua' },
  address: { ru: 'Астана, ул. Е-899, 1/1', kk: 'Астана, Е-899 көшесі, 1/1' },
  location: { lat: 51.0762, lng: 71.4125 },
  phone: '+77172000000',
  whatsapp: '+77010000000',
  timezone: 'Asia/Almaty',
  openingHours: {},
  isOpenNow: true,
  acceptsDelivery: true,
  acceptsPickup: true,
  acceptsReservations: true,
  paymentMethods: ['online', 'on_receipt'],
  stopListMode: 'mark_unavailable',
};

describe('openingHoursSpecification', () => {
  it('объединяет дни с одинаковым интервалом в одну спецификацию', () => {
    const all = Object.fromEntries(
      ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, [{ open: '10:00', close: '00:00' }]]),
    );
    const spec = openingHoursSpecification(all);
    expect(spec).toHaveLength(1);
    expect(spec[0]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [
        'https://schema.org/Monday',
        'https://schema.org/Tuesday',
        'https://schema.org/Wednesday',
        'https://schema.org/Thursday',
        'https://schema.org/Friday',
        'https://schema.org/Saturday',
        'https://schema.org/Sunday',
      ],
      opens: '10:00',
      closes: '00:00',
    });
  });

  it('сохраняет интервалы через полночь и несколько интервалов в день, пропускает выходные', () => {
    const spec = openingHoursSpecification({
      mon: [{ open: '10:00', close: '23:00' }],
      fri: [{ open: '10:00', close: '02:00' }],
      sat: [
        { open: '09:00', close: '14:00' },
        { open: '16:00', close: '02:00' },
      ],
      sun: [],
    });
    expect(spec).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Monday'], opens: '10:00', closes: '23:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Friday'], opens: '10:00', closes: '02:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Saturday'], opens: '09:00', closes: '14:00' },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Saturday'], opens: '16:00', closes: '02:00' },
    ]);
  });

  it('пустые часы → пустой список', () => {
    expect(openingHoursSpecification(undefined)).toEqual([]);
    expect(openingHoursSpecification({})).toEqual([]);
  });
});

describe('JSON-LD', () => {
  it('Restaurant содержит адрес, координаты, телефон, кухню, бронь и меню', () => {
    const data = restaurantJsonLd({
      branch: { ...branch, openingHours: { mon: [{ open: '10:00', close: '23:00' }] } },
      locale: 'ru',
      url: `${SITE}/ru/branches/greenline`,
      menuUrl: `${SITE}/ru/greenline/menu`,
    });
    expect(data).toMatchObject({
      '@type': 'Restaurant',
      name: 'AULA GreenLine Aqua',
      telephone: '+77172000000',
      address: { '@type': 'PostalAddress', streetAddress: 'Астана, ул. Е-899, 1/1', addressCountry: 'KZ' },
      geo: { '@type': 'GeoCoordinates', latitude: 51.0762, longitude: 71.4125 },
      servesCuisine: ['Казахская кухня', 'Kazakh'],
      acceptsReservations: true,
      hasMenu: `${SITE}/ru/greenline/menu`,
    });
    expect((data.openingHoursSpecification as unknown[]).length).toBe(1);
  });

  it('цена в Offer — тенге строкой без плавающей точки', () => {
    expect(offerPrice({ amount: 250000, currency: 'KZT' })).toBe('2500');
    expect(offerPrice({ amount: 250050, currency: 'KZT' })).toBe('2500.50');
    expect(offerPrice({ amount: 5, currency: 'KZT' })).toBe('0.05');
  });

  it('Menu/MenuSection/MenuItem с предложениями в KZT', () => {
    const data = menuJsonLd({
      name: 'Меню',
      url: `${SITE}/ru/greenline/menu`,
      locale: 'ru',
      sections: [
        {
          name: 'Горячее',
          items: [
            { name: 'Бешбармак', price: { amount: 450000, currency: 'KZT' } },
            { name: 'Баурсаки', price: { amount: 90000, currency: 'KZT' }, available: false },
            { name: 'Без цены', price: null },
          ],
        },
      ],
    });
    const items = (data.hasMenuSection as Array<{ hasMenuItem: Array<Record<string, unknown>> }>)[0]!.hasMenuItem;
    expect(items[0]!.offers).toEqual({
      '@type': 'Offer',
      price: '4500',
      priceCurrency: 'KZT',
      availability: 'https://schema.org/InStock',
    });
    expect((items[1]!.offers as Record<string, string>).availability).toBe('https://schema.org/OutOfStock');
    expect(items[2]!.offers).toBeUndefined();
  });

  it('сериализация экранирует </script>', () => {
    const text = serializeJsonLd({ name: '</script><script>alert(1)</script>' });
    expect(text).not.toContain('</script>');
    expect(JSON.parse(text)).toEqual({ name: '</script><script>alert(1)</script>' });
  });
});

describe('метаданные страниц', () => {
  it('canonical и hreflang для всех языков + x-default', () => {
    expect(localizedUrl('kk', '/', SITE)).toBe('https://aula.kz/kk');
    expect(localizedUrl('ru', 'branches/', SITE)).toBe('https://aula.kz/ru/branches');
    expect(normalizePath('')).toBe('/');
    expect(languageAlternates('/branches', SITE)).toEqual({
      kk: 'https://aula.kz/kk/branches',
      ru: 'https://aula.kz/ru/branches',
      en: 'https://aula.kz/en/branches',
      'x-default': 'https://aula.kz/ru/branches',
    });
    const meta = buildMetadata({ locale: 'kk', path: '/branches', title: 'T', description: 'D', siteUrl: SITE });
    expect(meta.alternates?.canonical).toBe('https://aula.kz/kk/branches');
    expect(meta.openGraph).toMatchObject({ locale: 'kk_KZ', url: 'https://aula.kz/kk/branches', siteName: 'AULA' });
    expect(meta.robots).toBeUndefined();
    expect(buildMetadata({ locale: 'ru', path: '/cart', title: 'T', description: 'D', noindex: true, siteUrl: SITE }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it('обрезает description по границе слова', () => {
    const long = 'слово '.repeat(60);
    const cut = truncateDescription(long, 50);
    expect(cut.length).toBeLessThanOrEqual(50);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('карта сайта', () => {
  it('включает статические разделы и страницы филиалов на всех языках; каталог — если есть', () => {
    const withoutCatalog = buildSitemapEntries({ siteUrl: SITE, branches: [branch], catalog: null });
    const urls = withoutCatalog.map((e) => e.url);
    expect(urls).toContain('https://aula.kz/ru');
    expect(urls).toContain('https://aula.kz/kk/branches/greenline');
    expect(urls).toContain('https://aula.kz/en/greenline/menu');
    expect(urls.some((u) => u.includes('/cart'))).toBe(false);

    const withCatalog = buildSitemapEntries({
      siteUrl: SITE,
      branches: [branch],
      catalog: {
        categories: [
          { branchSlug: 'greenline', slug: 'hot', updatedAt: '2026-09-01T00:00:00Z' },
          { branchSlug: 'closed-branch', slug: 'hot' },
        ],
        dishes: [{ branchSlug: 'greenline', categorySlug: 'hot', slug: 'beshbarmak' }],
      },
    });
    const catalogUrls = withCatalog.map((e) => e.url);
    expect(catalogUrls).toContain('https://aula.kz/ru/greenline/menu/hot');
    expect(catalogUrls).toContain('https://aula.kz/kk/greenline/menu/hot/beshbarmak');
    expect(catalogUrls.some((u) => u.includes('closed-branch'))).toBe(false);
  });
});

describe('переключение филиала в адресе меню', () => {
  it('подменяет slug только на страницах меню филиала', () => {
    expect(switchBranchInPath('/greenline/menu/hot/beshbarmak', 'garden-view')).toBe('/garden-view/menu/hot/beshbarmak');
    expect(switchBranchInPath('/greenline/menu', 'garden-view')).toBe('/garden-view/menu');
    expect(switchBranchInPath('/branches/greenline', 'garden-view')).toBeNull();
    expect(switchBranchInPath('/menu', 'garden-view')).toBeNull();
    expect(switchBranchInPath('/', 'garden-view')).toBeNull();
  });
});
