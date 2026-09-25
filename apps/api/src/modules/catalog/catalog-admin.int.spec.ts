import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import { CatalogEvents } from './public';
import {
  API,
  auditRows,
  branch,
  branchManager,
  contentManager,
  createCatalogTestApp,
  resetCatalogTest,
  createCategory,
  createDish,
  createGroup,
  operator,
  publishedEvents,
  testImage,
} from './testing/catalog-test-kit';

describe('Catalog admin: categories, dishes, modifiers (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => resetCatalogTest(t));

  describe('access', () => {
    it('is closed by default: 401 without token, 403 without menu permissions', async () => {
      expect((await t.http().get(`${API}/admin/catalog/categories`)).status).toBe(401);
      const branchId = await branch(t, 'gl');
      const op = await operator(t, branchId);
      const res = await t.http().get(`${API}/admin/catalog/categories`).set('authorization', op.auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('access.forbidden');
    });

    it('branch manager reads the catalog but cannot change menu composition', async () => {
      const branchId = await branch(t, 'gl');
      const cm = await contentManager(t);
      await createCategory(t, cm.auth);
      const bm = await branchManager(t, branchId);
      const list = await t.http().get(`${API}/admin/catalog/categories`).set('authorization', bm.auth);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);
      const denied = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', bm.auth)
        .send({ name: { ru: 'Супы' } });
      expect(denied.status).toBe(403);
    });
  });

  describe('categories', () => {
    it('creates with transliterated unique slug, validates manual slug, audits and publishes MenuChanged', async () => {
      const cm = await contentManager(t);
      const first = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'Горячие блюда', kk: 'Ыстық тағамдар' }, description: { ru: 'Лагман и плов' } });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ slug: 'goryachie-blyuda', isActive: true, dishCount: 0 });
      expect(first.body.missingTranslations).toEqual([{ field: 'description', missing: ['kk'] }]);

      const second = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'Горячие блюда' } });
      expect(second.body.slug).toBe('goryachie-blyuda-2');

      const conflict = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', cm.auth)
        .send({ slug: 'goryachie-blyuda', name: { ru: 'Другое' } });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('catalog.slug_taken');

      const invalid = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', cm.auth)
        .send({ slug: 'Горячее', name: { ru: 'Другое' } });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('catalog.invalid_slug');

      const noName = await t
        .http()
        .post(`${API}/admin/catalog/categories`)
        .set('authorization', cm.auth)
        .send({ name: { en: 'Hot dishes' } });
      expect(noName.status).toBe(422);
      expect(noName.body.error.code).toBe('translatable.required');

      const audit = await auditRows(t, 'menu.category_created');
      expect(audit).toHaveLength(2);
      expect(audit[0]).toMatchObject({ entity_type: 'category', entity_id: first.body.id, actor_kind: 'staff', actor_user_id: cm.userId });
      expect(audit[0]!.after.slug).toBe('goryachie-blyuda');
      const events = await publishedEvents(t, CatalogEvents.MenuChanged);
      expect(events).toContainEqual({ branchId: null, categoryId: first.body.id });
    });

    it('updates with before/after audit, reorders, forbids deleting non-empty category', async () => {
      const cm = await contentManager(t);
      const hot = await createCategory(t, cm.auth);
      const soups = await createCategory(t, cm.auth, { name: { ru: 'Супы', kk: 'Сорпалар' }, sortOrder: 5 });
      const updated = await t
        .http()
        .put(`${API}/admin/catalog/categories/${hot}`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'Горячее', kk: 'Ыстық' }, slug: 'goryachee', isActive: false });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ slug: 'goryachee', isActive: false, name: { ru: 'Горячее', kk: 'Ыстық' } });
      const [audit] = await auditRows(t, 'menu.category_updated');
      expect(audit!.before.name).toEqual({ ru: 'Горячие блюда', kk: 'Ыстық тағамдар' });
      expect(audit!.after.name).toEqual({ ru: 'Горячее', kk: 'Ыстық' });

      const reordered = await t.http().put(`${API}/admin/catalog/categories/order`).set('authorization', cm.auth).send({ ids: [hot, soups] });
      expect(reordered.status).toBe(200);
      expect(reordered.body.map((c: { id: string }) => c.id)).toEqual([hot, soups]);

      await createDish(t, cm.auth, soups, { name: { ru: 'Сорпа', kk: 'Сорпа' } });
      const notEmpty = await t.http().delete(`${API}/admin/catalog/categories/${soups}`).set('authorization', cm.auth);
      expect(notEmpty.status).toBe(409);
      expect(notEmpty.body.error.code).toBe('catalog.category_not_empty');

      expect((await t.http().delete(`${API}/admin/catalog/categories/${hot}`).set('authorization', cm.auth)).status).toBe(204);
      expect((await t.http().get(`${API}/admin/catalog/categories/${hot}`).set('authorization', cm.auth)).status).toBe(404);
      expect((await auditRows(t, 'menu.category_deleted'))[0]!.before.id).toBe(hot);
    });

    it('uploads category image as webp variants', async () => {
      const cm = await contentManager(t);
      const id = await createCategory(t, cm.auth);
      const res = await t
        .http()
        .post(`${API}/admin/catalog/categories/${id}/image`)
        .set('authorization', cm.auth)
        .attach('file', await testImage(1600, 900), { filename: 'hot.png', contentType: 'image/png' });
      expect(res.status).toBe(201);
      expect(res.body.image.variants.map((v: { width: number }) => v.width)).toEqual([300, 600, 1200]);
      expect(res.body.image.url).toMatch(/\/files\/public\/catalog\/categories\/.+-600\.webp$/);
      const removed = await t.http().delete(`${API}/admin/catalog/categories/${id}/image`).set('authorization', cm.auth);
      expect(removed.body.image).toBeNull();
    });
  });

  describe('dishes', () => {
    it('creates a dish without price, with attributes, modifiers and audit', async () => {
      const cm = await contentManager(t);
      const category = await createCategory(t, cm.auth);
      const size = await createGroup(t, cm.auth);
      const res = await t
        .http()
        .post(`${API}/admin/catalog/dishes`)
        .set('authorization', cm.auth)
        .send({
          categoryId: category,
          name: { ru: 'Лагман гуйру', kk: 'Гуйру лағман' },
          description: { ru: 'Тянутая лапша' },
          composition: { ru: 'Лапша, говядина, перец', kk: 'Кеспе, сиыр еті, бұрыш' },
          weightGrams: 450,
          calories: 680,
          spicyLevel: 2,
          allergens: ['eggs', 'gluten'],
          sku: 'POS-401',
          modifierGroupIds: [size.id],
          seoTitle: { ru: 'Лагман в Астане' },
        });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        slug: 'lagman-guyru',
        weightGrams: 450,
        calories: 680,
        spicyLevel: 2,
        isHalal: true,
        isVegetarian: false,
        allergens: ['gluten', 'eggs'],
        sku: 'POS-401',
        modifierGroupIds: [size.id],
        photos: [],
        branchPrices: [],
      });
      expect(res.body).not.toHaveProperty('price');
      expect(res.body.missingTranslations).toEqual([
        { field: 'description', missing: ['kk'] },
        { field: 'seoTitle', missing: ['kk'] },
      ]);
      const [audit] = await auditRows(t, 'menu.dish_created');
      expect(audit!.after).toMatchObject({ slug: 'lagman-guyru', modifierGroupIds: [size.id] });
      expect(await publishedEvents(t, CatalogEvents.MenuChanged)).toContainEqual({ branchId: null, dishId: res.body.id, categoryId: category });
    });

    it('validates input: category, spicy level, allergens, translations, POS code uniqueness', async () => {
      const cm = await contentManager(t);
      const category = await createCategory(t, cm.auth);
      const post = (body: Record<string, unknown>) =>
        t
          .http()
          .post(`${API}/admin/catalog/dishes`)
          .set('authorization', cm.auth)
          .send({ categoryId: category, name: { ru: 'Плов' }, ...body });

      const unknownCategory = await post({ categoryId: '0192f0c8-0000-7000-8000-000000000000' });
      expect(unknownCategory.status).toBe(422);
      expect(unknownCategory.body.error.code).toBe('catalog.unknown_category');
      expect((await post({ spicyLevel: 5 })).status).toBe(400);
      expect((await post({ allergens: ['bread'] })).status).toBe(400);
      expect((await post({ price: { amount: 100 } })).status).toBe(400);
      expect((await post({ name: { en: 'Pilaf' } })).body.error.code).toBe('translatable.required');
      const unknownGroup = await post({ modifierGroupIds: ['0192f0c8-0000-7000-8000-000000000000'] });
      expect(unknownGroup.body.error.code).toBe('catalog.unknown_modifier_group');
      expect((await post({ sku: 'P-1' })).status).toBe(201);
      const skuTaken = await post({ sku: 'P-1', name: { ru: 'Плов 2' } });
      expect(skuTaken.status).toBe(409);
      expect(skuTaken.body.error.code).toBe('catalog.sku_taken');
    });

    it('updates partially, moves between categories, searches and deletes', async () => {
      const cm = await contentManager(t);
      const hot = await createCategory(t, cm.auth);
      const kazakh = await createCategory(t, cm.auth, { name: { ru: 'Казахская кухня', kk: 'Қазақ асханасы' } });
      const id = await createDish(t, cm.auth, hot, { spicyLevel: 1, allergens: ['gluten'] });
      const updated = await t
        .http()
        .put(`${API}/admin/catalog/dishes/${id}`)
        .set('authorization', cm.auth)
        .send({ categoryId: kazakh, name: { ru: 'Бешбармак по-казахски', kk: 'Қазақша бешбармақ' } });
      expect(updated.status).toBe(200);
      expect(updated.body).toMatchObject({ categoryId: kazakh, slug: 'beshbarmak', spicyLevel: 1, allergens: ['gluten'], weightGrams: 500 });
      const [audit] = await auditRows(t, 'menu.dish_updated');
      expect(audit!.before.categoryId).toBe(hot);
      expect(audit!.after.categoryId).toBe(kazakh);

      await createDish(t, cm.auth, hot, { name: { ru: 'Плов', kk: 'Палау' } });
      const search = await t.http().get(`${API}/admin/catalog/dishes?q=бешб`).set('authorization', cm.auth);
      expect(search.body.total).toBe(1);
      expect(search.body.items[0].id).toBe(id);
      const byCategory = await t.http().get(`${API}/admin/catalog/dishes?categoryId=${hot}&page=1&perPage=10`).set('authorization', cm.auth);
      expect(byCategory.body).toMatchObject({ total: 1, page: 1, perPage: 10 });

      expect((await t.http().delete(`${API}/admin/catalog/dishes/${id}`).set('authorization', cm.auth)).status).toBe(204);
      expect((await t.http().get(`${API}/admin/catalog/dishes/${id}`).set('authorization', cm.auth)).status).toBe(404);
      expect(await auditRows(t, 'menu.dish_deleted')).toHaveLength(1);
      // Slug освобождается после логического удаления.
      const again = await createDish(t, cm.auth, hot);
      expect(again).not.toBe(id);
    });

    it('uploads, reorders and removes photos (webp 1200/600/300 in public storage)', async () => {
      const cm = await contentManager(t);
      const id = await createDish(t, cm.auth, await createCategory(t, cm.auth));
      const upload = await t
        .http()
        .post(`${API}/admin/catalog/dishes/${id}/photos`)
        .set('authorization', cm.auth)
        .attach('files', await testImage(1600, 1200), { filename: 'a.png', contentType: 'image/png' })
        .attach('files', await testImage(640, 480, '#27ae60'), { filename: 'b.png', contentType: 'image/png' });
      expect(upload.status).toBe(201);
      const [a, b] = upload.body.photos;
      expect(a.variants.map((v: { width: number }) => v.width)).toEqual([300, 600, 1200]);
      expect(a.variants[2].height).toBe(900);
      // Меньшее изображение не увеличивается.
      expect(b.variants.map((v: { width: number }) => v.width)).toEqual([300, 600, 640]);
      const storageRoot = resolve(t.config.storage.localDir, 'public');
      expect(existsSync(join(storageRoot, `catalog/dishes/${id}/${a.id}-600.webp`))).toBe(true);

      const reordered = await t
        .http()
        .put(`${API}/admin/catalog/dishes/${id}/photos/order`)
        .set('authorization', cm.auth)
        .send({ photoIds: [b.id, a.id] });
      expect(reordered.body.photos.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
      const mismatch = await t
        .http()
        .put(`${API}/admin/catalog/dishes/${id}/photos/order`)
        .set('authorization', cm.auth)
        .send({ photoIds: [a.id] });
      expect(mismatch.body.error.code).toBe('catalog.photos_mismatch');

      const removed = await t.http().delete(`${API}/admin/catalog/dishes/${id}/photos/${b.id}`).set('authorization', cm.auth);
      expect(removed.body.photos.map((p: { id: string }) => p.id)).toEqual([a.id]);
      expect((await auditRows(t, 'menu.dish_photos_added')).length).toBe(1);
      expect((await auditRows(t, 'menu.dish_photo_removed')).length).toBe(1);
    });

    it('rejects invalid images', async () => {
      const cm = await contentManager(t);
      const id = await createDish(t, cm.auth, await createCategory(t, cm.auth));
      const url = `${API}/admin/catalog/dishes/${id}/photos`;
      const garbage = await t
        .http()
        .post(url)
        .set('authorization', cm.auth)
        .attach('files', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
      expect(garbage.status).toBe(422);
      expect(garbage.body.error.code).toBe('catalog.image_invalid');
      const small = await t
        .http()
        .post(url)
        .set('authorization', cm.auth)
        .attach('files', await testImage(120, 120), { filename: 's.png', contentType: 'image/png' });
      expect(small.body.error.code).toBe('catalog.image_too_small');
      const gif = await t
        .http()
        .post(url)
        .set('authorization', cm.auth)
        .attach('files', Buffer.from('GIF89a'), { filename: 'x.gif', contentType: 'image/gif' });
      expect(gif.body.error.code).toBe('catalog.image_invalid_type');
      const none = await t.http().post(url).set('authorization', cm.auth).field('x', '1');
      expect(none.body.error.code).toBe('catalog.image_required');
    });
  });

  describe('modifier groups', () => {
    it('creates, updates options (prices audited), validates config and unlinks on delete', async () => {
      const cm = await contentManager(t);
      const group = await createGroup(t, cm.auth, { name: { ru: 'Соус', kk: 'Тұздық' }, minSelect: 0, maxSelect: 2, options: [
        { name: { ru: 'Томатный', kk: 'Қызанақ' }, price: { amount: 30_000 } },
        { name: { ru: 'Чесночный', kk: 'Сарымсақ' }, price: { amount: 30_000 } },
      ] });
      expect(group).toMatchObject({ code: 'sous', isRequired: false, minSelect: 0, maxSelect: 2, dishCount: 0 });
      const [tomato, garlic] = group.options as Array<{ id: string }>;

      const updated = await t
        .http()
        .put(`${API}/admin/catalog/modifier-groups/${group.id}`)
        .set('authorization', cm.auth)
        .send({
          name: { ru: 'Соус', kk: 'Тұздық' },
          minSelect: 1,
          maxSelect: 1,
          options: [
            { id: tomato!.id, name: { ru: 'Томатный', kk: 'Қызанақ' }, price: { amount: 35_000 }, isDefault: true },
            { name: { ru: 'Аджика', kk: 'Аджика' }, price: { amount: 40_000 } },
          ],
        });
      expect(updated.status).toBe(200);
      expect(updated.body.isRequired).toBe(true);
      expect(updated.body.options.map((o: { price: { amount: number } }) => o.price.amount)).toEqual([35_000, 40_000]);
      expect(updated.body.options.find((o: { id: string }) => o.id === garlic!.id)).toBeUndefined();
      const [audit] = await auditRows(t, 'menu.modifier_group_updated');
      expect(audit!.before.options[0].price).toEqual({ amount: 30_000, currency: 'KZT' });
      expect(audit!.after.options[0].price).toEqual({ amount: 35_000, currency: 'KZT' });

      const invalid = await t
        .http()
        .put(`${API}/admin/catalog/modifier-groups/${group.id}`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'Соус' }, minSelect: 3, maxSelect: 3, options: [{ name: { ru: 'Один' }, price: { amount: 0 } }] });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error).toMatchObject({ code: 'catalog.modifier_group_invalid', details: { reason: 'min_exceeds_options' } });
      const foreign = await t
        .http()
        .put(`${API}/admin/catalog/modifier-groups/${group.id}`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'Соус' }, minSelect: 0, maxSelect: 1, options: [{ id: '0192f0c8-0000-7000-8000-000000000000', name: { ru: 'X' }, price: { amount: 0 } }] });
      expect(foreign.body.error.code).toBe('catalog.unknown_modifier_option');
      const negative = await t
        .http()
        .post(`${API}/admin/catalog/modifier-groups`)
        .set('authorization', cm.auth)
        .send({ name: { ru: 'X' }, minSelect: 0, maxSelect: 1, options: [{ name: { ru: 'X' }, price: { amount: -1 } }] });
      expect(negative.status).toBe(400);

      const dish = await createDish(t, cm.auth, await createCategory(t, cm.auth), { modifierGroupIds: [group.id] });
      const withCount = await t.http().get(`${API}/admin/catalog/modifier-groups/${group.id}`).set('authorization', cm.auth);
      expect(withCount.body.dishCount).toBe(1);
      expect((await t.http().delete(`${API}/admin/catalog/modifier-groups/${group.id}`).set('authorization', cm.auth)).status).toBe(204);
      const dishAfter = await t.http().get(`${API}/admin/catalog/dishes/${dish}`).set('authorization', cm.auth);
      expect(dishAfter.body.modifierGroupIds).toEqual([]);
      expect((await auditRows(t, 'menu.modifier_group_deleted'))[0]!.before.dishIds).toEqual([dish]);
    });
  });

  describe('reference data and reports', () => {
    it('lists allergens and reports missing translations', async () => {
      const cm = await contentManager(t);
      const allergens = await t.http().get(`${API}/admin/catalog/allergens`).set('authorization', cm.auth);
      expect(allergens.body).toHaveLength(14);
      expect(allergens.body[0]).toEqual({ code: 'gluten', name: { ru: 'Глютен', kk: 'Глютен', en: 'Gluten' } });

      const category = await createCategory(t, cm.auth, { name: { ru: 'Десерты' } });
      await createDish(t, cm.auth, category, { name: { kk: 'Шақ-шақ' }, composition: null });
      await createGroup(t, cm.auth);
      const sauces = await createGroup(t, cm.auth, {
        name: { ru: 'Соусы', kk: 'Тұздықтар' },
        minSelect: 0,
        maxSelect: 2,
        options: [{ name: { ru: 'Томатный' }, price: { amount: 0 } }],
      });
      const report = await t.http().get(`${API}/admin/catalog/translations`).set('authorization', cm.auth);
      expect(report.status).toBe(200);
      expect(report.body.locales).toEqual(['kk', 'ru']);
      expect(report.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'category', entityId: category, field: 'name', missing: ['kk'], label: 'Десерты' }),
          expect.objectContaining({ entityType: 'dish', field: 'name', missing: ['ru'], label: 'Шақ-шақ', groupId: null }),
          // Опция модификатора ведёт в редактор своей группы.
          { entityType: 'modifier_option', entityId: sauces.options[0]!.id, label: 'Томатный', field: 'name', missing: ['kk'], groupId: sauces.id },
        ]),
      );
      expect(report.body.summary.find((s: { entityType: string }) => s.entityType === 'category')).toEqual({ entityType: 'category', total: 1, incomplete: 1 });
      expect(report.body.summary.find((s: { entityType: string }) => s.entityType === 'modifier_group')).toMatchObject({ incomplete: 0 });

      const onlyDishes = await t.http().get(`${API}/admin/catalog/translations?entityType=dish&locales=kk,ru,en`).set('authorization', cm.auth);
      expect(onlyDishes.body.summary).toHaveLength(1);
      expect(onlyDishes.body.items[0].missing).toEqual(['ru', 'en']);

      const branchId = await branch(t, 'gl');
      const bm = await branchManager(t, branchId);
      expect((await t.http().get(`${API}/admin/catalog/translations`).set('authorization', bm.auth)).status).toBe(403);
    });
  });
});
