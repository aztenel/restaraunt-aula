import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { newId } from '../../shared/kernel/ids';
import { seedPos } from './infrastructure/seed';
import { createPosTestApp, ORG_ID, PosTestContext, routeToIiko } from './testing/pos-test-app';

const NOMENCLATURE = {
  correlationId: 'c',
  groups: [{ id: 'G-HOT', name: 'Горячее' }],
  products: [
    { id: 'P-PLOV', code: 'A-100', name: 'Плов узбекский 350 г', type: 'Dish', parentGroup: 'G-HOT', isDeleted: false },
    { id: 'P-LAGMAN', code: 'A-200', name: 'Лагман гуйру', type: 'Dish', parentGroup: 'G-HOT', isDeleted: false },
    { id: 'P-TEA', code: 'B-1', name: 'Чай чёрный', type: 'Good', isDeleted: false },
    { id: 'M-CHEESE', code: 'M-1', name: 'Сыр', type: 'Modifier', isDeleted: false },
    { id: 'P-OLD', code: 'X', name: 'Старое блюдо', type: 'Dish', isDeleted: true },
  ],
};

describe('POS: сопоставление блюд и номенклатура (integration)', () => {
  let ctx: PosTestContext;
  let t: TestApp;

  beforeAll(async () => {
    ctx = await createPosTestApp();
    t = ctx.t;
  });
  afterAll(async () => t.close());
  beforeEach(async () => ctx.reset());

  const db = () => t.database.rootConnection();

  it('mappings CRUD with validation, conflict, audit; modifier options; soft delete', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = ctx.fakes.menu.add({ name: 'Плов', price: 250_000 });
    const optionId = newId();
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const api = t.http();

    const created = await api
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({
        branchId,
        dishId: plov.dishId,
        externalProductId: ' P-PLOV ',
        externalName: 'Плов (POS)',
        modifiers: [{ optionId, externalProductId: 'M-CHEESE', externalGroupId: 'G-ADD' }],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      branchId,
      dishId: plov.dishId,
      dishName: { ru: 'Плов' },
      provider: 'iiko',
      externalProductId: 'P-PLOV',
      externalName: 'Плов (POS)',
      modifiers: [{ optionId, externalProductId: 'M-CHEESE', externalGroupId: 'G-ADD' }],
    });

    const duplicate = await api.post('/api/v1/admin/pos/mappings').set('authorization', admin.auth).send({ branchId, dishId: plov.dishId, externalProductId: 'P-2' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('pos.mapping_exists');

    const notInMenu = await api.post('/api/v1/admin/pos/mappings').set('authorization', admin.auth).send({ branchId, dishId: newId(), externalProductId: 'P-2' });
    expect(notInMenu.status).toBe(422);
    expect(notInMenu.body.error.code).toBe('pos.dish_not_in_branch_menu');

    const badOption = await api
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({ branchId, dishId: plov.dishId, externalProductId: 'P', modifiers: [{ optionId: 'x', externalProductId: 'M' }] });
    expect(badOption.status).toBe(400);

    const unknownProvider = await api
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({ branchId, dishId: plov.dishId, externalProductId: 'P', provider: 'nope' });
    expect(unknownProvider.status).toBe(422);
    expect(unknownProvider.body.error.code).toBe('pos.unknown_provider');

    const updated = await api
      .put(`/api/v1/admin/pos/mappings/${created.body.id}`)
      .set('authorization', admin.auth)
      .send({ externalProductId: 'P-PLOV-2', modifiers: [] });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ externalProductId: 'P-PLOV-2', externalName: null, modifiers: [] });

    const list = await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}`).set('authorization', admin.auth);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ total: 1, page: 1, perPage: 50 });
    expect(list.body.items[0].dishName).toEqual({ ru: 'Плов' });

    const removed = await api.delete(`/api/v1/admin/pos/mappings/${created.body.id}`).set('authorization', admin.auth);
    expect(removed.status).toBe(204);
    expect((await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}`).set('authorization', admin.auth)).body.total).toBe(0);
    expect((await api.delete(`/api/v1/admin/pos/mappings/${created.body.id}`).set('authorization', admin.auth)).status).toBe(404);
    const row = await sql<any>`select deleted_at from pos.product_mappings where id = ${created.body.id}`.execute(db());
    expect(row.rows[0].deleted_at).not.toBeNull();

    // После удаления блюдо можно сопоставить снова.
    const again = await api.post('/api/v1/admin/pos/mappings').set('authorization', admin.auth).send({ branchId, dishId: plov.dishId, externalProductId: 'P-PLOV' });
    expect(again.status).toBe(201);

    const audit = await sql<{ action: string }>`
      select action from platform.audit_log where entity_type = 'pos_product_mapping' order by occurred_at, id`.execute(db());
    expect(audit.rows.map((r) => r.action)).toEqual(['pos.mapping_created', 'pos.mapping_updated', 'pos.mapping_deleted', 'pos.mapping_created']);
  });

  it('branch dishes for mapping (integrations.manage, no menu permission): mapping state per dish and option; search by external name', async () => {
    const branchId = await createBranch(t);
    const otherBranch = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const cheese = newId();
    const sauce = newId();
    const plov = ctx.fakes.menu.add({
      name: 'Плов',
      price: 250_000,
      sku: 'A-100',
      modifiers: [
        { groupId: 'g-add', optionId: cheese, name: 'Сыр', price: 30_000 },
        { groupId: 'g-add', optionId: sauce, name: 'Соус', price: 10_000 },
      ],
    });
    const lagman = ctx.fakes.menu.add({ name: 'Лагман', price: 200_000, availability: 'stopped_hidden' });
    ctx.fakes.menu.add({ name: 'Только в другом филиале', price: 1, branchIds: [otherBranch] });
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const api = t.http();
    const created = await api
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({ branchId, dishId: plov.dishId, externalProductId: 'P-PLOV', externalName: 'Плов узбекский 350 г', modifiers: [{ optionId: cheese, externalProductId: 'M-CHEESE' }] });
    expect(created.status).toBe(201);

    // Администратор системы: integrations.manage без права на меню каталога.
    const integrator = await tokenFor(t, [{ role: 'sysadmin' }]);
    const res = await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}`).set('authorization', integrator.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ branchId, provider: 'iiko', categories: [{ id: 'cat-1' }] });
    expect(res.body.dishes).toHaveLength(2);
    const plovRow = res.body.dishes.find((d: { dishId: string }) => d.dishId === plov.dishId);
    expect(plovRow).toMatchObject({
      name: { ru: 'Плов' },
      sku: 'A-100',
      price: { amount: 250_000, currency: 'KZT' },
      stopped: false,
      mapping: { mappingId: created.body.id, externalProductId: 'P-PLOV', externalName: 'Плов узбекский 350 г' },
      unmappedOptionIds: [sauce],
      modifierGroups: [
        {
          groupId: 'g-add',
          isRequired: false,
          options: [
            { optionId: cheese, name: { ru: 'Сыр' }, externalProductId: 'M-CHEESE', externalGroupId: null },
            { optionId: sauce, name: { ru: 'Соус' }, externalProductId: null, externalGroupId: null },
          ],
        },
      ],
    });
    expect(res.body.dishes.find((d: { dishId: string }) => d.dishId === lagman.dishId)).toMatchObject({ mapping: null, stopped: true, unmappedOptionIds: [] });

    const unmapped = await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}&unmappedOnly=true`).set('authorization', integrator.auth);
    expect(unmapped.body.dishes.map((d: { dishId: string }) => d.dishId)).toEqual([lagman.dishId]);
    const bySku = await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}&q=a-10`).set('authorization', integrator.auth);
    expect(bySku.body.dishes.map((d: { dishId: string }) => d.dishId)).toEqual([plov.dishId]);
    const byName = await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}&q=${encodeURIComponent('лагм')}`).set('authorization', integrator.auth);
    expect(byName.body.dishes.map((d: { dishId: string }) => d.dishId)).toEqual([lagman.dishId]);

    // Доступ: оператор филиала (orders.manage) и контент-менеджер — нет; без branchId — 400.
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    expect((await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}`).set('authorization', operator.auth)).status).toBe(403);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await api.get(`/api/v1/admin/pos/dishes?branchId=${branchId}`).set('authorization', content.auth)).status).toBe(403);
    expect((await api.get('/api/v1/admin/pos/dishes').set('authorization', admin.auth)).status).toBe(400);

    // Поиск сопоставлений по названию товара POS (без учёта регистра) и по id товара.
    const byExternal = await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}&q=${encodeURIComponent('УЗБЕКСК')}`).set('authorization', admin.auth);
    expect(byExternal.status).toBe(200);
    expect(byExternal.body.items.map((m: { id: string }) => m.id)).toEqual([created.body.id]);
    expect((await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}&q=p-pl`).set('authorization', admin.auth)).body.total).toBe(1);
    expect((await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}&q=${encodeURIComponent('%')}`).set('authorization', admin.auth)).body.total).toBe(0);
    expect((await api.get(`/api/v1/admin/pos/mappings?branchId=${branchId}&q=lagman`).set('authorization', admin.auth)).body.total).toBe(0);
  });

  it('mapping is not possible for a branch without an external POS (manual)', async () => {
    const branchId = await createBranch(t);
    const dish = ctx.fakes.menu.add({ name: 'Плов', price: 250_000 });
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const res = await t.http().post('/api/v1/admin/pos/mappings').set('authorization', admin.auth).send({ branchId, dishId: dish.dishId, externalProductId: 'P' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('pos.mapping_not_supported');
    const unknownBranch = await t
      .http()
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({ branchId: newId(), dishId: dish.dishId, externalProductId: 'P' });
    expect(unknownBranch.status).toBe(404);
  });

  it('mappings and nomenclature require integrations.manage', async () => {
    const branchId = await createBranch(t);
    expect((await t.http().get(`/api/v1/admin/pos/mappings?branchId=${branchId}`)).status).toBe(401);
    const manager = await tokenFor(t, [{ role: 'branch_manager', branchId }]);
    const requests = [
      () => t.http().get(`/api/v1/admin/pos/mappings?branchId=${branchId}`),
      () => t.http().get(`/api/v1/admin/pos/mappings/suggestions?branchId=${branchId}`),
      () => t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}`),
      () => t.http().post('/api/v1/admin/pos/products/import').send({ branchId }),
      () => t.http().post('/api/v1/admin/pos/mappings').send({ branchId, dishId: newId(), externalProductId: 'P' }),
    ];
    for (const request of requests) {
      const res = await request().set('authorization', manager.auth);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('access.forbidden');
    }
  });

  it('imports POS nomenclature by a job, marks removed products, lists them for the mapping screen', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    ctx.http
      .on('/api/1/access_token', 200, { token: 'tok' })
      .on('/api/1/nomenclature', 200, NOMENCLATURE, { times: 1 })
      .on('/api/1/nomenclature', 200, { ...NOMENCLATURE, products: NOMENCLATURE.products.filter((p) => p.id !== 'P-TEA') });

    const requested = await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId });
    expect(requested.status).toBe(202);
    expect(requested.body).toMatchObject({ queued: true, alreadyQueued: false });
    // Внешний вызов — только в задаче.
    expect(ctx.http.requests).toHaveLength(0);
    const repeated = await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId });
    expect(repeated.body.alreadyQueued).toBe(true);
    await t.drain();

    const nomenclature = ctx.http.requests.filter((r) => r.url.endsWith('/api/1/nomenclature'));
    expect(nomenclature).toHaveLength(1);
    expect(JSON.parse(nomenclature[0]!.body!)).toEqual({ organizationId: ORG_ID });

    const products = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}`).set('authorization', admin.auth);
    expect(products.status).toBe(200);
    expect(products.body.provider).toBe('iiko');
    expect(products.body.total).toBe(4);
    expect(products.body.items.map((p: { externalProductId: string }) => p.externalProductId)).toEqual(['P-LAGMAN', 'P-PLOV', 'M-CHEESE', 'P-TEA']);
    expect(products.body.items[1]).toMatchObject({ name: 'Плов узбекский 350 г', sku: 'A-100', kind: 'dish', groupName: 'Горячее', removed: false, mappedDishIds: [] });

    const modifiers = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}&kind=modifier`).set('authorization', admin.auth);
    expect(modifiers.body.items.map((p: { externalProductId: string }) => p.externalProductId)).toEqual(['M-CHEESE']);
    const search = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}&q=${encodeURIComponent('лагман')}`).set('authorization', admin.auth);
    expect(search.body.items.map((p: { externalProductId: string }) => p.externalProductId)).toEqual(['P-LAGMAN']);

    const status = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchId}`).set('authorization', admin.auth);
    expect(status.body[0].products).toMatchObject({ count: 4, error: null });

    // Повторный импорт: товар пропал из POS — помечается, но виден с includeRemoved.
    t.clock.advance(5 * 60_000);
    await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId });
    await t.drain();
    const after = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}`).set('authorization', admin.auth);
    expect(after.body.total).toBe(3);
    const withRemoved = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}&includeRemoved=true`).set('authorization', admin.auth);
    expect(withRemoved.body.items.find((p: { externalProductId: string }) => p.externalProductId === 'P-TEA').removed).toBe(true);
  });

  it('nomenclature import errors: 400 is recorded without retries; manual branch cannot import', async () => {
    const branchId = await createBranch(t);
    const manualBranch = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/nomenclature', 400, { errorDescription: 'Organization not found' });

    await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId });
    await t.drain();
    t.clock.advance(10 * 60_000);
    await t.drain();
    expect(ctx.http.requests.filter((r) => r.url.endsWith('/api/1/nomenclature'))).toHaveLength(1);
    const status = await t.http().get(`/api/v1/admin/pos/status?branchId=${branchId}`).set('authorization', admin.auth);
    expect(status.body[0].products.error).toContain('Organization not found');

    const manual = await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId: manualBranch });
    expect(manual.status).toBe(422);
    expect(manual.body.error.code).toBe('pos.nomenclature_unsupported');
  });

  it('suggests matches by POS code and by normalized name; bulk accept creates mappings', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const plov = ctx.fakes.menu.add({ name: 'Плов', price: 250_000 });
    const lagman = ctx.fakes.menu.add({ name: 'Лагман гуйру', price: 280_000 });
    const tea = ctx.fakes.menu.add({ name: 'Чай с молоком', price: 50_000, sku: 'B-1' });
    ctx.fakes.menu.add({ name: 'Манты', price: 300_000 });
    ctx.fakes.stopList.skus.set('B-1', tea.dishId);
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/nomenclature', 200, NOMENCLATURE);
    await t.http().post('/api/v1/admin/pos/products/import').set('authorization', admin.auth).send({ branchId });
    await t.drain();

    const res = await t.http().get(`/api/v1/admin/pos/mappings/suggestions?branchId=${branchId}`).set('authorization', admin.auth);
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe('iiko');
    // Модификаторы не предлагаются.
    expect(res.body.items.map((s: { product: { externalProductId: string } }) => s.product.externalProductId)).toEqual(['P-LAGMAN', 'P-PLOV', 'P-TEA']);
    const byProduct = Object.fromEntries(res.body.items.map((s: { product: { externalProductId: string }; candidates: unknown[] }) => [s.product.externalProductId, s.candidates]));
    expect(byProduct['P-LAGMAN'][0]).toMatchObject({ dishId: lagman.dishId, score: 1, method: 'name', dishName: { ru: 'Лагман гуйру' } });
    expect(byProduct['P-PLOV'][0]).toMatchObject({ dishId: plov.dishId, method: 'name' });
    expect(byProduct['P-PLOV'][0].score).toBeGreaterThanOrEqual(0.5);
    expect(byProduct['P-PLOV'][0].score).toBeLessThan(1);
    expect(byProduct['P-TEA'][0]).toMatchObject({ dishId: tea.dishId, method: 'sku', score: 1 });

    const bulk = await t
      .http()
      .post('/api/v1/admin/pos/mappings/bulk')
      .set('authorization', admin.auth)
      .send({
        branchId,
        items: [
          { dishId: lagman.dishId, externalProductId: 'P-LAGMAN' },
          { dishId: plov.dishId, externalProductId: 'P-PLOV' },
        ],
      });
    expect(bulk.status).toBe(200);
    expect(bulk.body).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    expect(bulk.body.items.find((m: { dishId: string }) => m.dishId === plov.dishId).externalName).toBe('Плов узбекский 350 г');

    const again = await t
      .http()
      .post('/api/v1/admin/pos/mappings/bulk')
      .set('authorization', admin.auth)
      .send({ branchId, items: [{ dishId: lagman.dishId, externalProductId: 'P-LAGMAN' }, { dishId: plov.dishId, externalProductId: 'P-TEA' }] });
    expect(again.body).toMatchObject({ created: 0, updated: 1, unchanged: 1 });

    const dup = await t
      .http()
      .post('/api/v1/admin/pos/mappings/bulk')
      .set('authorization', admin.auth)
      .send({ branchId, items: [{ dishId: tea.dishId, externalProductId: 'A' }, { dishId: tea.dishId, externalProductId: 'B' }] });
    expect(dup.status).toBe(422);
    expect(dup.body.error.code).toBe('pos.mapping_duplicate_dish');

    // Сопоставленные товары и блюда больше не предлагаются.
    const rest = await t.http().get(`/api/v1/admin/pos/mappings/suggestions?branchId=${branchId}`).set('authorization', admin.auth);
    expect(rest.body.items.map((s: { product: { externalProductId: string } }) => s.product.externalProductId)).toEqual(['P-PLOV']);
    expect(rest.body.items[0].candidates.map((c: { dishId: string }) => c.dishId)).not.toContain(plov.dishId);

    const products = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}&unmappedOnly=true`).set('authorization', admin.auth);
    expect(products.body.items.map((p: { externalProductId: string }) => p.externalProductId)).toEqual(['P-PLOV', 'M-CHEESE']);
    const mapped = await t.http().get(`/api/v1/admin/pos/products?branchId=${branchId}&q=A-200`).set('authorization', admin.auth);
    expect(mapped.body.items[0].mappedDishIds).toEqual([lagman.dishId]);
  });

  it('registers POS integrations in the integration catalog', async () => {
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const res = await t.http().get('/api/v1/admin/system/integrations/catalog').set('authorization', admin.auth);
    expect(res.status).toBe(200);
    const keys = res.body.map((d: { key: string }) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['pos.iiko', 'pos.routing']));
    const iiko = res.body.find((d: { key: string }) => d.key === 'pos.iiko');
    expect(iiko.fields.find((f: { name: string }) => f.name === 'apiLogin')).toMatchObject({ secret: true, required: true });
    const routing = res.body.find((d: { key: string }) => d.key === 'pos.routing');
    expect(routing.fields.find((f: { name: string }) => f.name === 'default').options).toEqual(['manual', 'iiko']);
  });

  it('seed creates the routing setting (manual) once and keeps an existing one', async () => {
    const logs: string[] = [];
    const seedCtx = { app: t.app, branches: {}, legalEntityId: '', ownerUserId: '', demo: true, log: (m: string) => logs.push(m) };
    await seedPos(seedCtx);
    const settings = t.get(IntegrationSettings);
    expect(await settings.getRaw('pos.routing')).toMatchObject({ enabled: true, config: { default: 'manual', branches: {} } });
    expect(logs).toHaveLength(1);

    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    await seedPos(seedCtx);
    expect((await settings.getRaw('pos.routing'))!.config).toEqual({ default: 'manual', branches: { [branchId]: 'iiko' } });
    expect(logs).toHaveLength(1);
  });

  it('describes every POS endpoint in OpenAPI with typed responses', async () => {
    const doc = buildOpenApiDocument(t.app, 'test');
    const paths = Object.keys(doc.paths).filter((p) => p.includes('/admin/pos'));
    expect(paths.sort()).toEqual([
      '/api/v1/admin/pos/dishes',
      '/api/v1/admin/pos/exports',
      '/api/v1/admin/pos/exports/retry-failed',
      '/api/v1/admin/pos/exports/{id}/retry',
      '/api/v1/admin/pos/mappings',
      '/api/v1/admin/pos/mappings/bulk',
      '/api/v1/admin/pos/mappings/suggestions',
      '/api/v1/admin/pos/mappings/{id}',
      '/api/v1/admin/pos/products',
      '/api/v1/admin/pos/products/import',
      '/api/v1/admin/pos/status',
      '/api/v1/admin/pos/stop-list/sync',
    ]);
    const status = doc.paths['/api/v1/admin/pos/status']!.get!;
    expect(status.tags).toEqual(['admin']);
    expect(JSON.stringify(status.responses['200'])).toContain('PosBranchStatusDto');
    expect(JSON.stringify(doc.paths['/api/v1/admin/pos/exports']!.get!.responses['200'])).toContain('OrderExportsPageDto');
    expect(doc.components?.schemas).toHaveProperty('OrderExportDto');
    expect(doc.components?.schemas).toHaveProperty('MappingSuggestionDto');
  });
});
