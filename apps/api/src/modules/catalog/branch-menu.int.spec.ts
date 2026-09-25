import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { TestApp } from '../../../test/support/test-app';
import { STOP_LIST_RESTORE_SCHEDULE } from './handlers/stop-list.scheduler';
import { CatalogEvents } from './public';
import {
  addToMenu,
  API,
  auditRows,
  branch,
  branchManager,
  contentManager,
  createCatalogTestApp,
  resetCatalogTest,
  createCategory,
  createDish,
  operator,
  publishedEvents,
  owner,
  setAvailability,
} from './testing/catalog-test-kit';

describe('Catalog: branch menu, prices and stop-list (integration)', () => {
  let t: TestApp;
  let gl: string;
  let gv: string;
  let cm: { auth: string; userId: string };
  let category: string;
  let besh: string;
  let plov: string;

  let fakes: Fakes;

  beforeAll(async () => {
    ({ t, fakes } = await createCatalogTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await resetCatalogTest(t);
    fakes.adminFeed.events = [];
    gl = await branch(t, 'gl');
    gv = await branch(t, 'gv', { stopListMode: 'hide' });
    cm = await contentManager(t);
    category = await createCategory(t, cm.auth);
    besh = await createDish(t, cm.auth, category);
    plov = await createDish(t, cm.auth, category, { name: { ru: 'Плов', kk: 'Палау' }, sku: 'POS-PLOV' });
  });

  const menu = (branchId: string, auth: string, query = '') => t.http().get(`${API}/admin/catalog/branches/${branchId}/menu${query}`).set('authorization', auth);

  it('dish is in a branch menu only with a price row; prices differ per branch', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    const glMenu = await menu(gl, cm.auth);
    expect(glMenu.status).toBe(200);
    expect(glMenu.body).toMatchObject({ total: 1, page: 1 });
    expect(glMenu.body.items[0]).toMatchObject({
      dishId: besh,
      price: { amount: 590_000, currency: 'KZT' },
      availability: 'available',
      displayAvailability: 'available',
      stoppedUntil: null,
      updatedBy: cm.userId,
    });
    expect((await menu(gv, cm.auth)).body.items[0].price.amount).toBe(630_000);

    const duplicate = await t.http().post(`${API}/admin/catalog/branches/${gl}/menu`).set('authorization', cm.auth).send({ dishId: besh, price: { amount: 1 } });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('catalog.dish_already_in_menu');
    const unknownBranch = await t
      .http()
      .post(`${API}/admin/catalog/branches/0192f0c8-0000-7000-8000-000000000000/menu`)
      .set('authorization', cm.auth)
      .send({ dishId: besh, price: { amount: 1 } });
    expect(unknownBranch.status).toBe(404);
    const negative = await t.http().post(`${API}/admin/catalog/branches/${gl}/menu`).set('authorization', cm.auth).send({ dishId: plov, price: { amount: -5 } });
    expect(negative.status).toBe(400);
    const fractional = await t.http().post(`${API}/admin/catalog/branches/${gl}/menu`).set('authorization', cm.auth).send({ dishId: plov, price: { amount: 10.5 } });
    expect(fractional.status).toBe(400);

    const added = await auditRows(t, 'menu.item_added');
    expect(added.map((a) => [a.branch_id, a.after.price.amount])).toEqual([
      [gl, 590_000],
      [gv, 630_000],
    ]);
    expect(await publishedEvents(t, CatalogEvents.MenuChanged)).toContainEqual({ branchId: gl, dishId: besh, categoryId: category });
  });

  it('branch manager changes prices only in own branch; every change is audited with before/after', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    const bm = await branchManager(t, gl);

    const own = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/price`).set('authorization', bm.auth).send({ price: { amount: 610_000 } });
    expect(own.status).toBe(200);
    expect(own.body.price.amount).toBe(610_000);
    const same = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/price`).set('authorization', bm.auth).send({ price: { amount: 610_000 } });
    expect(same.status).toBe(200);

    const foreign = await t.http().put(`${API}/admin/catalog/branches/${gv}/menu/${besh}/price`).set('authorization', bm.auth).send({ price: { amount: 1 } });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('access.forbidden');
    expect((await menu(gv, bm.auth)).status).toBe(403);
    const op = await operator(t, gl);
    expect((await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/price`).set('authorization', op.auth).send({ price: { amount: 1 } })).status).toBe(403);

    const changes = await auditRows(t, 'menu.price_changed');
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      entity_type: 'branch_dish_price',
      entity_id: besh,
      branch_id: gl,
      actor_user_id: bm.userId,
      before: { price: { amount: 590_000, currency: 'KZT' } },
      after: { price: { amount: 610_000, currency: 'KZT' } },
    });
    const notInMenu = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${plov}/price`).set('authorization', bm.auth).send({ price: { amount: 1 } });
    expect(notInMenu.status).toBe(404);
    expect(notInMenu.body.error.code).toBe('branch_menu_item.not_found');
  });

  it('bulk price update is all-or-nothing', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gl, plov, 350_000);
    const third = await createDish(t, cm.auth, category, { name: { ru: 'Манты', kk: 'Манты' } });
    const bm = await branchManager(t, gl);
    const failed = await t
      .http()
      .post(`${API}/admin/catalog/branches/${gl}/menu/bulk-prices`)
      .set('authorization', bm.auth)
      .send({ items: [{ dishId: besh, price: { amount: 1 } }, { dishId: third, price: { amount: 1 } }] });
    expect(failed.status).toBe(422);
    expect(failed.body.error).toMatchObject({ code: 'catalog.dish_not_in_branch_menu', details: { dishIds: [third] } });
    expect((await menu(gl, bm.auth)).body.items.map((i: { price: { amount: number } }) => i.price.amount).sort()).toEqual([350_000, 590_000]);

    const ok = await t
      .http()
      .post(`${API}/admin/catalog/branches/${gl}/menu/bulk-prices`)
      .set('authorization', bm.auth)
      .send({ items: [{ dishId: besh, price: { amount: 600_000 } }, { dishId: plov, price: { amount: 350_000 } }] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ updated: 1, unchanged: 1 });
    const [audit] = await auditRows(t, 'menu.price_changed');
    expect(audit!.meta).toEqual({ bulk: true });
  });

  it('bulk add of dishes to a branch menu is all-or-nothing; items show who changed them', async () => {
    const manty = await createDish(t, cm.auth, category, { name: { ru: 'Манты', kk: 'Манты' } });
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    const bm = await branchManager(t, gl);
    const bulk = (items: unknown[], auth = bm.auth, branchId = gl) =>
      t.http().post(`${API}/admin/catalog/branches/${branchId}/menu/bulk-add`).set('authorization', auth).send({ items });

    // Одно блюдо уже в меню — ничего не добавляется.
    const conflict = await bulk([
      { dishId: plov, price: { amount: 350_000 } },
      { dishId: besh, price: { amount: 600_000 } },
    ]);
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatchObject({ code: 'catalog.dish_already_in_menu', details: { dishIds: [besh] } });
    const unknown = await bulk([{ dishId: plov, price: { amount: 350_000 } }, { dishId: '01a0d872-0000-7000-8000-000000000000', price: { amount: 1 } }]);
    expect(unknown.status).toBe(404);
    expect((await bulk([{ dishId: plov, price: { amount: 1 } }, { dishId: plov, price: { amount: 2 } }])).status).toBe(422);
    const skuTwice = await bulk([
      { dishId: plov, price: { amount: 1 }, sku: 'X-1' },
      { dishId: manty, price: { amount: 2 }, sku: 'X-1' },
    ]);
    expect(skuTwice.body.error.code).toBe('catalog.sku_taken');
    expect((await bulk([{ dishId: plov, price: { amount: 350_000 } }], bm.auth, gv)).status).toBe(403);
    expect((await menu(gl, bm.auth)).body.items.map((i: { dishId: string }) => i.dishId)).toEqual([besh]);

    const ok = await bulk([
      { dishId: plov, price: { amount: 350_000 } },
      { dishId: manty, price: { amount: 250_000 }, sku: 'GL-MANTY' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ added: 2, dishIds: [plov, manty] });
    const items = (await menu(gl, bm.auth)).body.items as Array<{ dishId: string; sku: string | null; updatedByName: string | null; updatedBy: string }>;
    expect(items.map((i) => i.dishId).sort()).toEqual([besh, plov, manty].sort());
    expect(items.find((i) => i.dishId === manty)).toMatchObject({ sku: 'GL-MANTY', updatedBy: bm.userId, updatedByName: 'Управляющий' });
    expect(items.find((i) => i.dishId === besh)).toMatchObject({ updatedBy: cm.userId, updatedByName: 'Контент-менеджер' });
    expect((await auditRows(t, 'menu.item_added')).filter((a) => a.meta?.bulk)).toHaveLength(2);
    expect((await publishedEvents(t, CatalogEvents.MenuChanged)).at(-1)).toEqual({ branchId: gl });
  });

  it('copies menu between branches: adds missing, overwrites prices on request, does not copy stop-list', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gl, plov, 350_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    const o = await owner(t);
    await setAvailability(t, o.auth, gl, plov, { available: false });

    const copy = await t.http().post(`${API}/admin/catalog/branches/${gv}/menu/copy`).set('authorization', cm.auth).send({ fromBranchId: gl });
    expect(copy.status).toBe(200);
    expect(copy.body).toEqual({ added: 1, updated: 0, unchanged: 1 });
    const gvMenu = (await menu(gv, cm.auth)).body.items as Array<{ dishId: string; price: { amount: number }; availability: string }>;
    expect(gvMenu.find((i) => i.dishId === besh)!.price.amount).toBe(630_000);
    expect(gvMenu.find((i) => i.dishId === plov)).toMatchObject({ price: { amount: 350_000 }, availability: 'available' });

    const overwrite = await t
      .http()
      .post(`${API}/admin/catalog/branches/${gv}/menu/copy`)
      .set('authorization', cm.auth)
      .send({ fromBranchId: gl, overwritePrices: true });
    expect(overwrite.body).toEqual({ added: 0, updated: 1, unchanged: 1 });
    expect((await auditRows(t, 'menu.branch_menu_copied')).length).toBe(2);
    const priceChange = (await auditRows(t, 'menu.price_changed')).at(-1)!;
    expect(priceChange).toMatchObject({ branch_id: gv, meta: { copiedFrom: gl } });

    const same = await t.http().post(`${API}/admin/catalog/branches/${gl}/menu/copy`).set('authorization', cm.auth).send({ fromBranchId: gl });
    expect(same.body.error.code).toBe('catalog.copy_same_branch');
    const bm = await branchManager(t, gl);
    expect((await t.http().post(`${API}/admin/catalog/branches/${gv}/menu/copy`).set('authorization', bm.auth).send({ fromBranchId: gl })).status).toBe(403);
  });

  it('removes a dish from a branch menu (logically) and allows adding it again', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    const removed = await t.http().delete(`${API}/admin/catalog/branches/${gl}/menu/${besh}`).set('authorization', cm.auth);
    expect(removed.status).toBe(204);
    expect((await menu(gl, cm.auth)).body.total).toBe(0);
    const [audit] = await auditRows(t, 'menu.item_removed');
    expect(audit!.before).toMatchObject({ price: { amount: 590_000 }, availability: 'available' });
    await addToMenu(t, cm.auth, gl, besh, 600_000);
    expect((await menu(gl, cm.auth)).body.items[0].price.amount).toBe(600_000);
    expect((await t.http().delete(`${API}/admin/catalog/branches/${gv}/menu/${besh}`).set('authorization', cm.auth)).status).toBe(404);
  });

  it('deleting a dish removes it from every branch menu', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    await t.http().delete(`${API}/admin/catalog/dishes/${besh}`).set('authorization', cm.auth);
    expect((await menu(gl, cm.auth)).body.total).toBe(0);
    expect((await menu(gv, cm.auth)).body.total).toBe(0);
    expect((await auditRows(t, 'menu.item_removed')).map((a) => a.branch_id).sort()).toEqual([gl, gv].sort());
  });

  it('branch POS code override: unique in branch, not equal to another dish code', async () => {
    await addToMenu(t, cm.auth, gl, besh, 590_000, 'GL-100');
    const item = await t.http().get(`${API}/admin/catalog/branches/${gl}/menu/${besh}`).set('authorization', cm.auth);
    expect(item.body).toMatchObject({ sku: 'GL-100', effectiveSku: 'GL-100' });
    const taken = await t.http().post(`${API}/admin/catalog/branches/${gl}/menu`).set('authorization', cm.auth).send({ dishId: plov, price: { amount: 1 }, sku: 'GL-100' });
    expect(taken.body.error.code).toBe('catalog.sku_taken');
    const global = await t.http().post(`${API}/admin/catalog/branches/${gv}/menu`).set('authorization', cm.auth).send({ dishId: besh, price: { amount: 1 }, sku: 'POS-PLOV' });
    expect(global.body.error.code).toBe('catalog.sku_taken');
    await addToMenu(t, cm.auth, gl, plov, 350_000);
    const plovItem = await t.http().get(`${API}/admin/catalog/branches/${gl}/menu/${plov}`).set('authorization', cm.auth);
    expect(plovItem.body).toMatchObject({ sku: null, effectiveSku: 'POS-PLOV' });
    const cleared = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/price`).set('authorization', cm.auth).send({ price: { amount: 590_000 }, sku: null });
    expect(cleared.body.sku).toBeNull();
    expect((await auditRows(t, 'menu.item_sku_changed'))[0]).toMatchObject({ before: { sku: 'GL-100' }, after: { sku: null } });

    // Только код POS, без цены.
    const skuOnly = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/sku`).set('authorization', cm.auth).send({ sku: ' gl-200 ' });
    expect(skuOnly.status).toBe(200);
    expect(skuOnly.body).toMatchObject({ sku: 'gl-200', effectiveSku: 'gl-200', price: { amount: 590_000 } });
    expect((await auditRows(t, 'menu.price_changed')).filter((a) => a.entity_id === besh)).toHaveLength(0);
    const skuTaken = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${plov}/sku`).set('authorization', cm.auth).send({ sku: 'gl-200' });
    expect(skuTaken.status).toBe(409);
    expect((await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/sku`).set('authorization', cm.auth).send({})).status).toBe(400);
    const reset = await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/sku`).set('authorization', cm.auth).send({ sku: null });
    expect(reset.body).toMatchObject({ sku: null, effectiveSku: null });
    const bmGv = await branchManager(t, gv);
    expect((await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/sku`).set('authorization', bmGv.auth).send({ sku: 'X' })).status).toBe(403);
    expect((await t.http().put(`${API}/admin/catalog/branches/${gl}/menu/${besh}/sku`).set('authorization', cm.auth).send({ sku: 5 })).status).toBe(400);
  });

  describe('stop-list', () => {
    beforeEach(async () => {
      await addToMenu(t, cm.auth, gl, besh, 590_000);
      await addToMenu(t, cm.auth, gv, besh, 630_000);
    });

    it('branch manager stops a dish in own branch with auto-restore; audit and events', async () => {
      const bm = await branchManager(t, gl);
      const until = new Date(t.clock.now().getTime() + 2 * 3_600_000).toISOString();
      const res = await setAvailability(t, bm.auth, gl, besh, { available: false, until, reason: 'Закончилась конина' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        changed: true,
        item: { availability: 'stopped', displayAvailability: 'stopped_shown', stopReason: 'Закончилась конина', stopSource: 'manual' },
      });
      expect(res.body.item.stoppedUntil).toBe(until);
      const again = await setAvailability(t, bm.auth, gl, besh, { available: false, until, reason: 'Закончилась конина' });
      expect(again.body.changed).toBe(false);

      const stopList = await t.http().get(`${API}/admin/catalog/branches/${gl}/stop-list`).set('authorization', bm.auth);
      expect(stopList.body.map((i: { dishId: string }) => i.dishId)).toEqual([besh]);

      const foreign = await setAvailability(t, bm.auth, gv, besh, { available: false });
      expect(foreign.status).toBe(403);
      // Контент-менеджер ведёт меню и цены, но не стоп-лист точки.
      expect((await setAvailability(t, cm.auth, gl, besh, { available: false })).status).toBe(403);

      const [audit] = await auditRows(t, 'menu.stop_list_changed');
      expect(audit).toMatchObject({
        entity_id: besh,
        branch_id: gl,
        actor_user_id: bm.userId,
        before: { availability: 'available' },
        after: { availability: 'stopped', stoppedUntil: until, stopReason: 'Закончилась конина' },
        meta: { source: 'manual' },
      });
      expect(await publishedEvents(t, CatalogEvents.StopListChanged)).toEqual([
        { branchId: gl, dishId: besh, availability: 'stopped_shown', source: 'manual', stoppedUntil: until, reason: 'Закончилась конина' },
      ]);

      // Автовозврат по расписанию после истечения «до».
      await t.runSchedule(STOP_LIST_RESTORE_SCHEDULE);
      expect((await t.http().get(`${API}/admin/catalog/branches/${gl}/stop-list`).set('authorization', bm.auth)).body).toHaveLength(1);
      t.clock.advance(2 * 3_600_000 + 1000);
      await t.runSchedule(STOP_LIST_RESTORE_SCHEDULE);
      const item = await t.http().get(`${API}/admin/catalog/branches/${gl}/menu/${besh}`).set('authorization', bm.auth);
      expect(item.body).toMatchObject({ availability: 'available', stoppedUntil: null, stopReason: null });
      const restoreAudit = (await auditRows(t, 'menu.stop_list_changed')).at(-1)!;
      expect(restoreAudit).toMatchObject({ actor_kind: 'system', meta: { auto: true, source: 'manual' }, after: { availability: 'available' } });
      expect((await publishedEvents(t, CatalogEvents.StopListChanged)).at(-1)).toMatchObject({ availability: 'available' });

      // Лента админки (поток заказов, без звука): блюдо встало в стоп и вернулось в продажу.
      await t.drain();
      expect(fakes.adminFeed.events).toEqual([
        { branchId: gl, stream: 'orders', kind: 'updated', entityId: besh, entityType: 'dish', title: 'Стоп-лист: Бешбармак — в стопе', sound: false },
        { branchId: gl, stream: 'orders', kind: 'updated', entityId: besh, entityType: 'dish', title: 'Стоп-лист: Бешбармак — снова в продаже', sound: false },
      ]);
    });

    it('stop until end of local day, hide-mode display, validation of until, manual restore', async () => {
      const o = await owner(t);
      const eod = await setAvailability(t, o.auth, gv, besh, { available: false, untilEndOfDay: true });
      // 2026-10-01 11:00 по Астане -> полночь 2026-10-02 00:00 (UTC+5).
      expect(eod.body.item).toMatchObject({ stoppedUntil: '2026-10-01T19:00:00.000Z', displayAvailability: 'stopped_hidden' });
      const past = await setAvailability(t, o.auth, gl, besh, { available: false, until: '2026-09-01T00:00:00.000Z' });
      expect(past.status).toBe(422);
      expect(past.body.error.code).toBe('catalog.stop_until_invalid');
      const both = await setAvailability(t, o.auth, gl, besh, { available: false, until: '2026-10-01T10:00:00.000Z', untilEndOfDay: true });
      expect(both.body.error.code).toBe('catalog.stop_until_invalid');
      const restored = await setAvailability(t, o.auth, gv, besh, { available: true });
      expect(restored.body).toMatchObject({ changed: true, item: { availability: 'available' } });
      const noop = await setAvailability(t, o.auth, gv, besh, { available: true });
      expect(noop.body.changed).toBe(false);
      const notInMenu = await setAvailability(t, o.auth, gv, plov, { available: false });
      expect(notInMenu.status).toBe(404);
    });
  });
});
