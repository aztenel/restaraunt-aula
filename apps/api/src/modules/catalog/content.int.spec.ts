import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TestApp } from '../../../test/support/test-app';
import { CatalogEvents } from './public';
import { API, auditRows, branch, branchManager, contentManager, createCatalogTestApp, resetCatalogTest, publishedEvents, testImage } from './testing/catalog-test-kit';

describe('Catalog content: banners, promotions, pages (integration)', () => {
  let t: TestApp;
  let gl: string;
  let gv: string;
  let cm: { auth: string; userId: string };

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await resetCatalogTest(t);
    gl = await branch(t, 'greenline');
    gv = await branch(t, 'garden-view');
    cm = await contentManager(t);
  });

  const day = 86_400_000;

  describe('banners', () => {
    it('content manager manages banners; public list respects placement, branch and active window', async () => {
      const now = t.clock.now().getTime();
      const post = (body: Record<string, unknown>) => t.http().post(`${API}/admin/content/banners`).set('authorization', cm.auth).send(body);
      const hero = await post({
        placement: 'home_hero',
        title: { ru: 'Бешбармак с доставкой', kk: 'Жеткізумен бешбармақ' },
        subtitle: { ru: 'Цены как в ресторане' },
        ctaLabel: { ru: 'Открыть меню', kk: 'Мәзірді ашу' },
        linkUrl: '/menu',
      });
      expect(hero.status).toBe(201);
      expect(hero.body).toMatchObject({ placement: 'home_hero', branchId: null, linkUrl: '/menu', isActive: true, image: null });
      expect(hero.body.missingTranslations).toEqual([{ field: 'subtitle', missing: ['kk'] }]);
      await post({ placement: 'menu_top', branchId: gl, title: { ru: 'Бизнес-ланч в GreenLine' }, sortOrder: 1 });
      await post({ placement: 'home_hero', title: { ru: 'Будущий' }, activeFrom: new Date(now + day).toISOString() });
      await post({ placement: 'home_hero', title: { ru: 'Прошедший' }, activeTo: new Date(now - day).toISOString() });
      await post({ placement: 'home_hero', title: { ru: 'Выключен' }, isActive: false });

      const pub = await t.http().get(`${API}/public/content/banners?placement=home_hero&locale=kk`);
      expect(pub.status).toBe(200);
      expect(pub.headers['cache-control']).toContain('s-maxage=60');
      expect(pub.body).toEqual([
        { id: hero.body.id, placement: 'home_hero', title: 'Жеткізумен бешбармақ', subtitle: 'Цены как в ресторане', ctaLabel: 'Мәзірді ашу', linkUrl: '/menu', image: null },
      ]);
      const glTop = await t.http().get(`${API}/public/content/banners?placement=menu_top&branch=greenline`);
      expect(glTop.body.map((b: { title: string }) => b.title)).toEqual(['Бизнес-ланч в GreenLine']);
      expect((await t.http().get(`${API}/public/content/banners?placement=menu_top&branch=garden-view`)).body).toEqual([]);
      expect((await t.http().get(`${API}/public/content/banners?placement=sidebar`)).status).toBe(400);
      expect((await t.http().get(`${API}/public/content/banners?branch=unknown`)).status).toBe(404);

      const badLink = await post({ placement: 'home_hero', title: { ru: 'X' }, linkUrl: 'javascript:alert(1)' });
      expect(badLink.body.error.code).toBe('content.invalid_link');
      const badWindow = await post({ placement: 'home_hero', title: { ru: 'X' }, activeFrom: new Date(now).toISOString(), activeTo: new Date(now - 1000).toISOString() });
      expect(badWindow.body.error.code).toBe('content.invalid_period');

      const image = await t
        .http()
        .post(`${API}/admin/content/banners/${hero.body.id}/image`)
        .set('authorization', cm.auth)
        .attach('file', await testImage(2400, 800), { filename: 'hero.png', contentType: 'image/png' });
      expect(image.status).toBe(201);
      expect(image.body.image.variants.map((v: { width: number }) => v.width)).toEqual([600, 1200, 1920]);
      expect(image.body.image.url).toMatch(/-1200\.webp$/);
      // Слишком большой файл — 413 с кодом каталога.
      const huge = await t
        .http()
        .post(`${API}/admin/content/banners/${hero.body.id}/image`)
        .set('authorization', cm.auth)
        .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1), { filename: 'huge.png', contentType: 'image/png' });
      expect(huge.status).toBe(413);
      expect(huge.body.error.code).toBe('catalog.image_too_large');
      // Изображение можно убрать; повтор ничего не меняет.
      const removed = await t.http().delete(`${API}/admin/content/banners/${hero.body.id}/image`).set('authorization', cm.auth);
      expect(removed.status).toBe(200);
      expect(removed.body.image).toBeNull();
      expect((await t.http().delete(`${API}/admin/content/banners/${hero.body.id}/image`).set('authorization', cm.auth)).status).toBe(200);
      expect(await auditRows(t, 'content.banner_image_removed')).toHaveLength(1);
      const bm = await branchManager(t, gl);
      expect((await t.http().delete(`${API}/admin/content/banners/${hero.body.id}/image`).set('authorization', bm.auth)).status).toBe(403);

      const updated = await t
        .http()
        .put(`${API}/admin/content/banners/${hero.body.id}`)
        .set('authorization', cm.auth)
        .send({ placement: 'home_secondary', title: { ru: 'Банкеты', kk: 'Банкеттер' } });
      expect(updated.body).toMatchObject({ placement: 'home_secondary', linkUrl: '/menu' });
      expect((await t.http().delete(`${API}/admin/content/banners/${hero.body.id}`).set('authorization', cm.auth)).status).toBe(204);
      expect((await t.http().get(`${API}/public/content/banners?placement=home_secondary`)).body).toEqual([]);

      expect((await auditRows(t, 'content.banner_created')).length).toBe(5);
      expect((await auditRows(t, 'content.banner_updated'))[0]!.before.placement).toBe('home_hero');
      expect(await publishedEvents(t, CatalogEvents.ContentChanged)).toContainEqual({ kind: 'banner', id: hero.body.id, branchId: null });
    });

    it('requires content.manage: branch manager and anonymous are rejected', async () => {
      expect((await t.http().get(`${API}/admin/content/banners`)).status).toBe(401);
      const bm = await branchManager(t, gl);
      const res = await t.http().post(`${API}/admin/content/banners`).set('authorization', bm.auth).send({ placement: 'home_hero', title: { ru: 'X' } });
      expect(res.status).toBe(403);
    });
  });

  describe('promotions', () => {
    it('manages promotions with branch scope and validity; public list and page by slug', async () => {
      const now = t.clock.now().getTime();
      const post = (body: Record<string, unknown>) => t.http().post(`${API}/admin/content/promotions`).set('authorization', cm.auth).send(body);
      const lunch = await post({
        title: { ru: 'Бизнес-ланч', kk: 'Бизнес-ланч' },
        description: { ru: 'Салат, суп, горячее и напиток', kk: 'Салат, көже, ыстық тағам және сусын' },
        terms: { ru: 'По будням с 12:00 до 16:00' },
        branchIds: [gl],
        validTo: new Date(now + 30 * day).toISOString(),
      });
      expect(lunch.status).toBe(201);
      expect(lunch.body).toMatchObject({ slug: 'biznes-lanch', branchIds: [gl] });
      const season = await post({ title: { ru: 'Сезон кумыса', kk: 'Қымыз маусымы' } });
      await post({ title: { ru: 'Старая акция' }, validTo: new Date(now - day).toISOString(), slug: 'old' });

      const gvList = await t.http().get(`${API}/public/content/promotions?branch=garden-view`);
      expect(gvList.body.map((p: { slug: string }) => p.slug)).toEqual(['sezon-kumysa']);
      const glList = await t.http().get(`${API}/public/content/promotions?branch=greenline&locale=kk`);
      expect(glList.body.map((p: { title: string }) => p.title).sort()).toEqual(['Бизнес-ланч', 'Қымыз маусымы']);
      const page = await t.http().get(`${API}/public/content/promotions/biznes-lanch`);
      expect(page.body).toMatchObject({ slug: 'biznes-lanch', terms: 'По будням с 12:00 до 16:00', seo: { title: 'Бизнес-ланч' } });
      expect((await t.http().get(`${API}/public/content/promotions/old`)).status).toBe(404);

      const conflict = await post({ title: { ru: 'X' }, slug: 'biznes-lanch' });
      expect(conflict.body.error.code).toBe('content.slug_taken');
      const unknownBranch = await post({ title: { ru: 'X' }, branchIds: ['0192f0c8-0000-7000-8000-000000000000'] });
      expect(unknownBranch.body.error.code).toBe('content.unknown_branch');

      const upd = await t
        .http()
        .put(`${API}/admin/content/promotions/${season.body.id}`)
        .set('authorization', cm.auth)
        .send({ title: { ru: 'Сезон кумыса', kk: 'Қымыз маусымы' }, branchIds: [gv] });
      expect(upd.body.branchIds).toEqual([gv]);
      const withImage = await t
        .http()
        .post(`${API}/admin/content/promotions/${season.body.id}/image`)
        .set('authorization', cm.auth)
        .attach('file', await testImage(1600, 900), { filename: 'kumys.png', contentType: 'image/png' });
      expect(withImage.status).toBe(201);
      expect(withImage.body.image).not.toBeNull();
      const noImage = await t.http().delete(`${API}/admin/content/promotions/${season.body.id}/image`).set('authorization', cm.auth);
      expect(noImage.status).toBe(200);
      expect(noImage.body.image).toBeNull();
      expect((await auditRows(t, 'content.promotion_image_removed'))[0]).toMatchObject({ entity_id: season.body.id, after: null });
      expect((await publishedEvents(t, CatalogEvents.ContentChanged)).filter((e: any) => e.id === season.body.id).length).toBeGreaterThanOrEqual(3);
      expect((await t.http().delete(`${API}/admin/content/promotions/${lunch.body.id}`).set('authorization', cm.auth)).status).toBe(204);
      expect((await t.http().get(`${API}/public/content/promotions/biznes-lanch`)).status).toBe(404);

      const sitemap = await t.http().get(`${API}/public/catalog/sitemap`);
      expect(sitemap.body.promotions.map((p: { slug: string }) => p.slug)).toEqual(['sezon-kumysa']);
    });
  });

  describe('pages', () => {
    it('previews sanitized HTML without saving', async () => {
      const preview = await t
        .http()
        .post(`${API}/admin/content/pages/preview`)
        .set('authorization', cm.auth)
        .send({ body: { ru: '<h2 onclick="x()">Доставка</h2><script>alert(1)</script>', kk: '<p>Жеткізу</p>', en: '<script>x</script>' } });
      expect(preview.status).toBe(200);
      expect(preview.body).toEqual({ body: { ru: '<h2>Доставка</h2>', kk: '<p>Жеткізу</p>' }, changed: true });
      const clean = await t.http().post(`${API}/admin/content/pages/preview`).set('authorization', cm.auth).send({ body: { ru: '<p>Текст</p>' } });
      expect(clean.body).toEqual({ body: { ru: '<p>Текст</p>' }, changed: false });
      expect((await t.http().get(`${API}/admin/content/pages`).set('authorization', cm.auth)).body).toEqual([]);
      const bm = await branchManager(t, gl);
      expect((await t.http().post(`${API}/admin/content/pages/preview`).set('authorization', bm.auth).send({ body: { ru: 'x' } })).status).toBe(403);
      expect((await t.http().post(`${API}/admin/content/pages/preview`).set('authorization', cm.auth).send({})).status).toBe(400);
    });

    it('stores sanitized HTML, publishes by slug, protects legal pages', async () => {
      const created = await t
        .http()
        .post(`${API}/admin/content/pages`)
        .set('authorization', cm.auth)
        .send({
          slug: 'privacy',
          title: { ru: 'Политика конфиденциальности', kk: 'Құпиялылық саясаты' },
          body: { ru: '<h2 onclick="x()">Политика</h2><script>alert(1)</script><p>Текст</p>', kk: '<p>Мәтін</p><iframe src="x"></iframe>' },
        });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ slug: 'privacy', isPublished: true, isProtected: true, body: { ru: '<h2>Политика</h2><p>Текст</p>', kk: '<p>Мәтін</p>' } });

      const about = await t
        .http()
        .post(`${API}/admin/content/pages`)
        .set('authorization', cm.auth)
        .send({ title: { ru: 'О нас', kk: 'Біз туралы' }, body: { ru: '<p>AULA — рестораны казахской кухни</p>' } });
      expect(about.body).toMatchObject({ slug: 'o-nas', missingTranslations: [{ field: 'body', missing: ['kk'] }] });

      const pub = await t.http().get(`${API}/public/content/pages/privacy?locale=kk`);
      expect(pub.status).toBe(200);
      expect(pub.body).toMatchObject({ slug: 'privacy', title: 'Құпиялылық саясаты', bodyHtml: '<p>Мәтін</p>', seo: { title: 'Құпиялылық саясаты', description: 'Мәтін' } });
      const list = await t.http().get(`${API}/public/content/pages`);
      expect(list.body.map((p: { slug: string }) => p.slug).sort()).toEqual(['o-nas', 'privacy']);

      const unpublish = await t
        .http()
        .put(`${API}/admin/content/pages/${created.body.id}`)
        .set('authorization', cm.auth)
        .send({ title: { ru: 'Политика' }, body: { ru: '<p>Новая редакция</p>' }, isPublished: false });
      expect(unpublish.status).toBe(409);
      expect(unpublish.body.error.code).toBe('content.page_protected');
      expect((await t.http().delete(`${API}/admin/content/pages/${created.body.id}`).set('authorization', cm.auth)).body.error.code).toBe(
        'content.page_protected',
      );
      const edited = await t
        .http()
        .put(`${API}/admin/content/pages/${created.body.id}`)
        .set('authorization', cm.auth)
        .send({ title: { ru: 'Политика' }, body: { ru: '<p>Новая редакция</p>' } });
      expect(edited.body.body).toEqual({ ru: '<p>Новая редакция</p>' });
      const [audit] = await auditRows(t, 'content.page_updated');
      expect(audit!.before.body.ru).toBe('<h2>Политика</h2><p>Текст</p>');

      const emptyBody = await t.http().post(`${API}/admin/content/pages`).set('authorization', cm.auth).send({ title: { ru: 'Пусто' }, body: { ru: '<script>x</script>' } });
      expect(emptyBody.body.error.code).toBe('translatable.required');

      await t.http().put(`${API}/admin/content/pages/${about.body.id}`).set('authorization', cm.auth).send({ title: { ru: 'О нас' }, body: { ru: '<p>x</p>' }, isPublished: false });
      expect((await t.http().get(`${API}/public/content/pages/o-nas`)).status).toBe(404);
      expect((await t.http().delete(`${API}/admin/content/pages/${about.body.id}`).set('authorization', cm.auth)).status).toBe(204);
    });
  });
});
