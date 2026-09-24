import { describe, expect, it } from 'vitest';
import { Money } from '../../../shared/kernel/money';
import { buildSeo, decimalPrice, menuItemJsonLd, menuJsonLd, priceRange, restaurantJsonLd, splitAddress, truncateText } from './seo';

describe('seo', () => {
  it('explicit SEO fields win, otherwise name + suffix and description fallbacks', () => {
    expect(
      buildSeo({ seoTitle: { ru: 'Бешбармак в Астане' }, seoDescription: { ru: 'Лучший' }, name: { ru: 'Бешбармак' }, fallbackDescriptions: [] }, 'ru'),
    ).toEqual({ title: 'Бешбармак в Астане', description: 'Лучший' });
    expect(
      buildSeo(
        {
          seoTitle: {},
          seoDescription: null,
          name: { ru: 'Бешбармак', kk: 'Ет' },
          fallbackDescriptions: [{}, { kk: 'Жылқы еті', ru: 'Конина' }],
          titleSuffix: 'AULA',
        },
        'kk',
      ),
    ).toEqual({ title: 'Ет — AULA', description: 'Жылқы еті' });
    expect(buildSeo({ seoTitle: null, seoDescription: null, name: { ru: 'Плов' }, fallbackDescriptions: [] }, 'kk').description).toBe('Плов');
  });

  it('truncates on word boundary', () => {
    const text = 'Сочная баранина, рис девзира, морковь и специи — плов по-ташкентски готовится в казане на открытом огне';
    const short = truncateText(text, 60);
    expect(short.length).toBeLessThanOrEqual(60);
    expect(short.endsWith('…')).toBe(true);
    expect(truncateText('Коротко', 60)).toBe('Коротко');
  });

  it('formats price for schema.org without float', () => {
    expect(decimalPrice(Money.of(250_000))).toBe('2500.00');
    expect(decimalPrice(Money.of(250_050))).toBe('2500.50');
    expect(decimalPrice(Money.of(5))).toBe('0.05');
  });

  it('builds Menu / MenuItem JSON-LD', () => {
    const item = {
      name: 'Бешбармак',
      description: 'Конина, тесто',
      url: '/greenline/menu/beshbarmak',
      image: null,
      price: Money.tenge(4900),
      available: false,
      isVegetarian: false,
      isHalal: true,
      calories: 850,
      weightGrams: 450,
    };
    const ld = menuItemJsonLd(item);
    expect(ld).toMatchObject({
      '@type': 'MenuItem',
      offers: { price: '4900.00', priceCurrency: 'KZT', availability: 'https://schema.org/OutOfStock' },
      suitableForDiet: ['https://schema.org/HalalDiet'],
      nutrition: { calories: '850 calories', servingSize: '450 g' },
    });
    const menu = menuJsonLd({ name: 'Меню', locale: 'ru', url: null, sections: [{ name: 'Горячее', description: '', items: [item] }] });
    expect(menu).toMatchObject({ '@context': 'https://schema.org', '@type': 'Menu', hasMenuSection: [{ '@type': 'MenuSection', name: 'Горячее' }] });
  });

  it('builds Restaurant JSON-LD with address, geo, opening hours and menu', () => {
    const ld = restaurantJsonLd({
      name: 'AULA GreenLine Aqua',
      locale: 'ru',
      telephone: '+77172000000',
      address: 'Астана, ул. Е-899, 1/1',
      lat: 51.0762,
      lng: 71.4125,
      openingHours: { mon: [{ open: '10:00', close: '00:00' }], sat: [{ open: '11:00', close: '02:00' }] },
      acceptsReservations: true,
      priceRange: priceRange([Money.tenge(1900), Money.tenge(12900), Money.tenge(5900)]),
      menu: { '@context': 'https://schema.org', '@type': 'Menu', name: 'Меню' },
    });
    expect(ld).toMatchObject({
      '@type': 'Restaurant',
      address: { '@type': 'PostalAddress', addressCountry: 'KZ', addressLocality: 'Астана', streetAddress: 'ул. Е-899, 1/1' },
      geo: { latitude: 51.0762, longitude: 71.4125 },
      servesCuisine: ['Казахская', 'Европейская', 'Халал'],
      priceRange: '1 900–12 900 KZT',
      hasMenu: { '@type': 'Menu', name: 'Меню' },
      openingHoursSpecification: [
        { dayOfWeek: 'https://schema.org/Monday', opens: '10:00', closes: '00:00' },
        { dayOfWeek: 'https://schema.org/Saturday', opens: '11:00', closes: '02:00' },
      ],
    });
    expect((ld.hasMenu as Record<string, unknown>)['@context']).toBeUndefined();
    expect(priceRange([])).toBeNull();
    expect(splitAddress('Астана, пр. Кабанбай батыра, 56')).toEqual({ locality: 'Астана', street: 'пр. Кабанбай батыра, 56' });
    expect(splitAddress('пр. Мангилик Ел 1')).toEqual({ locality: null, street: 'пр. Мангилик Ел 1' });
  });
});
