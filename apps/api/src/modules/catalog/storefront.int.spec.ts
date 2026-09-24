import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import {
  addToMenu,
  API,
  branch,
  contentManager,
  createCatalogTestApp,
  resetCatalogTest,
  createCategory,
  createDish,
  createGroup,
  owner,
  setAvailability,
  testImage,
} from './testing/catalog-test-kit';

describe('Catalog storefront: public menu, search, sitemap (integration)', () => {
  let t: TestApp;
  let gl: string;
  let gv: string;
  let cm: { auth: string };
  let hot: string;
  let salads: string;
  let besh: string;
  let lagman: string;
  let achichuk: string;
  let greek: string;

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await resetCatalogTest(t);
    gl = await branch(t, 'greenline');
    gv = await branch(t, 'garden-view', { stopListMode: 'hide' });
    cm = await contentManager(t);
    salads = await createCategory(t, cm.auth, { name: { ru: 'Салаты', kk: 'Салаттар' }, sortOrder: 10, seoTitle: { ru: 'Салаты в Астане' } });
    hot = await createCategory(t, cm.auth, { name: { ru: 'Горячие блюда', kk: 'Ыстық тағамдар' }, sortOrder: 20 });
    const size = await createGroup(t, cm.auth);
    besh = await createDish(t, cm.auth, hot, {
      description: { ru: 'Отварная конина и баранина с тестом', kk: 'Жылқы және қой еті, қамырмен' },
      allergens: ['gluten'],
      calories: 950,
      modifierGroupIds: [size.id],
      seoDescription: { ru: 'Бешбармак по семейному рецепту' },
    });
    lagman = await createDish(t, cm.auth, hot, {
      name: { ru: 'Лагман', kk: 'Лағман' },
      composition: { ru: 'Лапша, говядина, перец' },
      spicyLevel: 2,
    });
    achichuk = await createDish(t, cm.auth, salads, {
      name: { ru: 'Ачичук' },
      composition: { ru: 'Помидоры, лук, острый перец' },
      isVegetarian: true,
      spicyLevel: 1,
    });
    greek = await createDish(t, cm.auth, salads, {
      name: { ru: 'Греческий салат', kk: 'Грек салаты' },
      composition: { ru: 'Томаты, огурцы, фета', kk: 'Қызанақ, қияр, фета' },
      isVegetarian: true,
      isHalal: false,
    });
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gl, lagman, 340_000);
    await addToMenu(t, cm.auth, gl, achichuk, 190_000);
    await addToMenu(t, cm.auth, gl, greek, 260_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    await addToMenu(t, cm.auth, gv, lagman, 350_000);
  });

  it('full branch menu: categories -> dishes with branch prices, flags, SEO, JSON-LD and CDN cache headers', async () => {
    const res = await t.http().get(`${API}/public/catalog/branches/greenline/menu?locale=ru`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, s-maxage=60, stale-while-revalidate=300');
    expect(res.body.branch).toMatchObject({ id: gl, slug: 'greenline' });
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toEqual(['salaty', 'goryachie-blyuda']);
    const [saladSection, hotSection] = res.body.categories;
    expect(saladSection.seo.title).toBe('Салаты в Астане');
    expect(hotSection.seo.title).toBe('Горячие блюда — Филиал GREENL');
    expect(hotSection.dishes.map((d: { slug: string }) => d.slug)).toEqual(['beshbarmak', 'lagman']);
    expect(hotSection.dishes[0]).toMatchObject({
      name: 'Бешбармак',
      price: { amount: 590_000, currency: 'KZT' },
      available: true,
      availability: 'available',
      weightGrams: 500,
      calories: 950,
      isHalal: true,
      spicyLevel: 0,
      allergens: [{ code: 'gluten', name: 'Глютен' }],
      photo: null,
      hasModifiers: true,
      hasRequiredModifiers: true,
      categorySlug: 'goryachie-blyuda',
    });
    expect(res.body.structuredData).toMatchObject({ '@type': 'Menu', inLanguage: 'ru' });
    expect(res.body.structuredData.hasMenuSection[1].hasMenuItem[0].offers).toMatchObject({ price: '5900.00', priceCurrency: 'KZT' });
    expect(res.body.restaurantStructuredData).toMatchObject({
      '@type': 'Restaurant',
      telephone: '+77172000000',
      address: { addressLocality: 'Астана', addressCountry: 'KZ' },
      priceRange: '1 900–5 900 KZT',
      hasMenu: { '@type': 'Menu' },
    });
    expect(res.body.restaurantStructuredData.openingHoursSpecification).toHaveLength(7);

    const gvMenu = await t.http().get(`${API}/public/catalog/branches/garden-view/menu`);
    expect(gvMenu.body.categories.map((c: { slug: string }) => c.slug)).toEqual(['goryachie-blyuda']);
    expect(gvMenu.body.categories[0].dishes[0].price.amount).toBe(630_000);

    expect((await t.http().get(`${API}/public/catalog/branches/unknown/menu`)).status).toBe(404);
  });

  it('translates by ?locale with fallback ru -> kk', async () => {
    const kk = await t.http().get(`${API}/public/catalog/branches/greenline/menu?locale=kk`);
    const salad = kk.body.categories[0];
    expect(salad.name).toBe('Салаттар');
    expect(salad.dishes.map((d: { name: string }) => d.name)).toEqual(['Ачичук', 'Грек салаты']);
    expect(salad.dishes[0].name).toBe('Ачичук');
    const header = await t.http().get(`${API}/public/catalog/branches/greenline/dishes/beshbarmak`).set('x-locale', 'kk');
    expect(header.body.name).toBe('Бешбармақ');
    expect(header.body.allergens).toEqual([{ code: 'gluten', name: 'Глютен' }]);
  });

  it('stop-list display follows branch setting: hide or mark unavailable', async () => {
    const o = await owner(t);
    await setAvailability(t, o.auth, gl, lagman, { available: false });
    await setAvailability(t, o.auth, gv, lagman, { available: false });
    const glMenu = await t.http().get(`${API}/public/catalog/branches/greenline/menu`);
    const glLagman = glMenu.body.categories[1].dishes.find((d: { slug: string }) => d.slug === 'lagman');
    expect(glLagman).toMatchObject({ available: false, availability: 'stopped_shown' });

    const gvMenu = await t.http().get(`${API}/public/catalog/branches/garden-view/menu`);
    expect(gvMenu.body.categories[0].dishes.map((d: { slug: string }) => d.slug)).toEqual(['beshbarmak']);
    expect((await t.http().get(`${API}/public/catalog/branches/garden-view/dishes/lagman`)).status).toBe(404);
    const search = await t.http().get(`${API}/public/catalog/branches/garden-view/search?q=лагман`);
    expect(search.body.total).toBe(0);
    const sitemap = await t.http().get(`${API}/public/catalog/sitemap`);
    expect(sitemap.body.dishes.filter((d: { branchSlug: string }) => d.branchSlug === 'garden-view').map((d: { slug: string }) => d.slug)).toEqual([
      'beshbarmak',
    ]);
  });

  it('dish card: photos, composition, modifiers, SEO and MenuItem JSON-LD; 404 outside branch menu', async () => {
    await t
      .http()
      .post(`${API}/admin/catalog/dishes/${besh}/photos`)
      .set('authorization', cm.auth)
      .attach('files', await testImage(), { filename: 'b.png', contentType: 'image/png' });
    const res = await t.http().get(`${API}/public/catalog/branches/greenline/dishes/beshbarmak?locale=ru`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('s-maxage=60');
    expect(res.body).toMatchObject({
      slug: 'beshbarmak',
      composition: 'Конина, баранина, тесто, лук',
      category: { slug: 'goryachie-blyuda', name: 'Горячие блюда' },
      branch: { slug: 'greenline' },
      seo: { title: 'Бешбармак — Филиал GREENL', description: 'Бешбармак по семейному рецепту' },
    });
    expect(res.body.photos).toHaveLength(1);
    expect(res.body.photo.url).toMatch(/-600\.webp$/);
    expect(res.body.modifierGroups).toEqual([
      {
        id: expect.any(String),
        name: 'Размер порции',
        description: '',
        minSelect: 1,
        maxSelect: 1,
        isRequired: true,
        options: [
          { id: expect.any(String), name: 'Стандартная', price: { amount: 0, currency: 'KZT' }, isDefault: true },
          { id: expect.any(String), name: 'Большая', price: { amount: 190_000, currency: 'KZT' }, isDefault: false },
        ],
      },
    ]);
    expect(res.body.structuredData).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'MenuItem',
      offers: { price: '5900.00', availability: 'https://schema.org/InStock' },
      suitableForDiet: ['https://schema.org/HalalDiet'],
    });
    expect((await t.http().get(`${API}/public/catalog/branches/garden-view/dishes/achichuk`)).status).toBe(404);
    expect((await t.http().get(`${API}/public/catalog/branches/greenline/dishes/nope`)).body.error.code).toBe('dish.not_found');
  });

  it('category page with navigation; inactive categories and dishes are hidden', async () => {
    const res = await t.http().get(`${API}/public/catalog/branches/greenline/categories/salaty`);
    expect(res.status).toBe(200);
    expect(res.body.category).toMatchObject({ slug: 'salaty', dishCount: 2 });
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toEqual(['salaty', 'goryachie-blyuda']);
    expect(res.body.dishes.map((d: { slug: string }) => d.slug)).toEqual(['achichuk', 'grecheskiy-salat']);

    await t.http().put(`${API}/admin/catalog/dishes/${greek}`).set('authorization', cm.auth).send({ categoryId: salads, name: { ru: 'Греческий салат' }, isActive: false });
    expect((await t.http().get(`${API}/public/catalog/branches/greenline/categories/salaty`)).body.dishes).toHaveLength(1);
    await t.http().put(`${API}/admin/catalog/categories/${salads}`).set('authorization', cm.auth).send({ name: { ru: 'Салаты' }, isActive: false });
    expect((await t.http().get(`${API}/public/catalog/branches/greenline/categories/salaty`)).status).toBe(404);
    const menu = await t.http().get(`${API}/public/catalog/branches/greenline/menu`);
    expect(menu.body.categories.map((c: { slug: string }) => c.slug)).toEqual(['goryachie-blyuda']);
  });

  it('search: full-text (stemming, kk), partial match and filters vegetarian/spicy/halal/maxPrice/category', async () => {
    const search = (q: string) => t.http().get(`${API}/public/catalog/branches/greenline/search?${q}`);
    const slugs = (res: { body: { items: Array<{ slug: string }> } }) => res.body.items.map((d) => d.slug);

    expect(slugs(await search('q=бешб'))).toEqual(['beshbarmak']);
    expect(slugs(await search(`q=${encodeURIComponent('говядиной')}`))).toEqual(['lagman']);
    expect(slugs(await search(`q=${encodeURIComponent('Грек салаты')}&locale=kk`))).toEqual(['grecheskiy-salat']);
    expect(slugs(await search('q=помидор'))).toEqual(['achichuk']);
    expect(slugs(await search('vegetarian=true'))).toEqual(['achichuk', 'grecheskiy-salat']);
    expect(slugs(await search('spicy=true'))).toEqual(['achichuk', 'lagman']);
    expect(slugs(await search('spicy=false'))).toEqual(['grecheskiy-salat', 'beshbarmak']);
    expect(slugs(await search('maxSpicyLevel=1&vegetarian=true'))).toEqual(['achichuk', 'grecheskiy-salat']);
    expect(slugs(await search('halal=true&category=salaty'))).toEqual(['achichuk']);
    expect(slugs(await search('maxPrice=300000'))).toEqual(['achichuk', 'grecheskiy-salat']);
    expect(slugs(await search('category=unknown'))).toEqual([]);
    const paged = await search('perPage=2&page=2');
    expect(paged.body).toMatchObject({ total: 4, page: 2, perPage: 2 });
    expect(slugs(paged)).toEqual(['beshbarmak', 'lagman']);
    expect((await search('spicy=maybe')).status).toBe(400);
    expect((await search('maxPrice=-1')).status).toBe(400);
  });

  it('sitemap lists active branches, categories, dishes and pages with updatedAt; inactive branch is hidden', async () => {
    await branch(t, 'closed', {}, false);
    const res = await t.http().get(`${API}/public/catalog/sitemap`);
    expect(res.status).toBe(200);
    expect(res.body.branches.map((b: { slug: string }) => b.slug).sort()).toEqual(['garden-view', 'greenline']);
    expect(res.body.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ branchSlug: 'greenline', slug: 'salaty' }), expect.objectContaining({ branchSlug: 'garden-view', slug: 'goryachie-blyuda' })]),
    );
    expect(res.body.dishes).toContainEqual(
      expect.objectContaining({ branchSlug: 'greenline', categorySlug: 'goryachie-blyuda', slug: 'beshbarmak', updatedAt: expect.any(String) }),
    );
    expect(res.body.dishes).toHaveLength(6);
    expect((await t.http().get(`${API}/public/catalog/branches/closed/menu`)).status).toBe(404);
  });
});
