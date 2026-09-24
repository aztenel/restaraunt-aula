import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import { seedCatalog } from './infrastructure/seed';
import { SEED_DISHES } from './infrastructure/seed-menu';
import { MenuPricing } from './public';
import { API, branch, createCatalogTestApp, resetCatalogTest } from './testing/catalog-test-kit';

async function count(t: TestApp, table: string): Promise<number> {
  const res = await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)} where deleted_at is null`.execute(t.database.rootConnection());
  return Number(res.rows[0]!.n);
}

describe('Catalog seed (integration)', () => {
  let t: TestApp;
  let branches: Record<string, string>;
  const logs: string[] = [];

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await resetCatalogTest(t);
    branches = { greenline: await branch(t, 'greenline'), 'garden-view': await branch(t, 'garden-view') };
  });

  const run = (demo: boolean) =>
    seedCatalog({ app: t.app, branches, legalEntityId: 'le', ownerUserId: 'owner', demo, log: (m) => logs.push(m) });

  it('always creates static pages (ru + kk), without demo menu', async () => {
    await run(false);
    const pages = await t.http().get(`${API}/public/content/pages?locale=kk`);
    expect(pages.body.map((p: { slug: string }) => p.slug)).toEqual(['about', 'delivery', 'payment', 'offer', 'privacy', 'contacts']);
    const privacy = await t.http().get(`${API}/public/content/pages/privacy?locale=ru`);
    expect(privacy.body.bodyHtml).toContain('О персональных данных и их защите');
    const privacyKk = await t.http().get(`${API}/public/content/pages/privacy?locale=kk`);
    expect(privacyKk.body.title).toBe('Құпиялылық саясаты');
    const contacts = await t.http().get(`${API}/public/content/pages/contacts`);
    expect(contacts.body.bodyHtml).toContain('Кабанбай батыра, 56');
    expect(await count(t, 'catalog.dishes')).toBe(0);
  });

  it('demo: realistic menu with branch prices, modifiers, stop-list example, banners, promotions; idempotent', async () => {
    await run(true);
    const snapshot = {
      categories: await count(t, 'catalog.categories'),
      dishes: await count(t, 'catalog.dishes'),
      groups: await count(t, 'catalog.modifier_groups'),
      items: await count(t, 'catalog.branch_menu_items'),
      banners: await count(t, 'catalog.banners'),
      promotions: await count(t, 'catalog.promotions'),
      pages: await count(t, 'catalog.pages'),
    };
    expect(snapshot).toMatchObject({ categories: 8, dishes: SEED_DISHES.length, groups: 6, banners: 3, promotions: 2, pages: 6 });

    await run(true);
    expect({
      categories: await count(t, 'catalog.categories'),
      dishes: await count(t, 'catalog.dishes'),
      groups: await count(t, 'catalog.modifier_groups'),
      items: await count(t, 'catalog.branch_menu_items'),
      banners: await count(t, 'catalog.banners'),
      promotions: await count(t, 'catalog.promotions'),
      pages: await count(t, 'catalog.pages'),
    }).toEqual(snapshot);

    const gl = await t.http().get(`${API}/public/catalog/branches/greenline/menu?locale=kk`);
    const names = gl.body.categories.flatMap((c: { dishes: Array<{ name: string }> }) => c.dishes.map((d) => d.name));
    expect(names).toEqual(expect.arrayContaining(['Бешбармақ', 'Қазы', 'Қуырдақ', 'Шақ-шақ', 'Қымыз, 0,5 л', 'Шұбат, 0,5 л']));
    const glBesh = await t.http().get(`${API}/public/catalog/branches/greenline/dishes/beshbarmak`);
    const gvBesh = await t.http().get(`${API}/public/catalog/branches/garden-view/dishes/beshbarmak`);
    expect(glBesh.body.price.amount).toBe(590_000);
    expect(gvBesh.body.price.amount).toBe(630_000);
    expect(glBesh.body.modifierGroups.map((g: { name: string }) => g.name)).toEqual(['Размер порции', 'Добавки']);
    const gvShubat = await t.http().get(`${API}/public/catalog/branches/garden-view/dishes/shubat`);
    expect(gvShubat.body).toMatchObject({ available: false, availability: 'stopped_shown' });
    expect((await t.http().get(`${API}/public/catalog/branches/garden-view/dishes/ovoshchi-na-mangale`)).status).toBe(404);

    const [line] = await t.get(MenuPricing).priceLines(branches.greenline!, [{ dishId: glBesh.body.id, quantity: 1, modifierOptionIds: [] }]);
    expect(line!.sku).toBe('AULA-301');
    const banners = await t.http().get(`${API}/public/content/banners?branch=greenline`);
    expect(banners.body).toHaveLength(3);
    const promos = await t.http().get(`${API}/public/content/promotions?branch=garden-view`);
    expect(promos.body.map((p: { slug: string }) => p.slug)).toEqual(['sezon-kumysa']);
  });
});
