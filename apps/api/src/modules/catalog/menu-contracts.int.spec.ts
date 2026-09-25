import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RequestContext } from '../../shared/infrastructure/context/request-context';
import { DomainError } from '../../shared/kernel/errors';
import { TestApp } from '../../../test/support/test-app';
import { CatalogEvents, MenuPricing, MenuQuery, StopListControl } from './public';
import {
  addToMenu,
  API,
  auditRows,
  branch,
  contentManager,
  createCatalogTestApp,
  resetCatalogTest,
  createCategory,
  createDish,
  createGroup,
  publishedEvents,
  owner,
  setAvailability,
} from './testing/catalog-test-kit';

async function codeOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
  } catch (e) {
    return (e as DomainError).code;
  }
  return null;
}

describe('Catalog public contracts: MenuPricing, MenuQuery, StopListControl (integration)', () => {
  let t: TestApp;
  let pricing: MenuPricing;
  let query: MenuQuery;
  let stopList: StopListControl;
  let gl: string;
  let gv: string;
  let cm: { auth: string };
  let category: string;
  let besh: string;
  let plov: string;
  let kazy: string;
  let size: { id: string; options: Array<{ id: string }> };
  let extras: { id: string; options: Array<{ id: string }> };

  beforeAll(async () => {
    ({ t } = await createCatalogTestApp());
    pricing = t.get(MenuPricing);
    query = t.get(MenuQuery);
    stopList = t.get(StopListControl);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await resetCatalogTest(t);
    gl = await branch(t, 'gl');
    gv = await branch(t, 'gv', { stopListMode: 'hide' });
    cm = await contentManager(t);
    category = await createCategory(t, cm.auth, { name: { ru: 'Казахская кухня', kk: 'Қазақ асханасы' } });
    size = await createGroup(t, cm.auth);
    extras = await createGroup(t, cm.auth, {
      name: { ru: 'Добавки', kk: 'Қосымшалар' },
      minSelect: 0,
      maxSelect: 3,
      options: [
        { name: { ru: 'Баурсаки, 5 шт.', kk: 'Бауырсақ, 5 дана' }, price: { amount: 70_000 } },
        { name: { ru: 'Лук', kk: 'Пияз' }, price: { amount: 0 } },
      ],
    });
    besh = await createDish(t, cm.auth, category, { modifierGroupIds: [size.id, extras.id], sku: 'POS-1' });
    plov = await createDish(t, cm.auth, category, {
      name: { ru: 'Плов с бараниной', kk: 'Қой етімен палау' },
      composition: { ru: 'Рис, баранина, морковь, нут', kk: 'Күріш, қой еті, сәбіз, ноқат' },
    });
    kazy = await createDish(t, cm.auth, category, { name: { ru: 'Казы', kk: 'Қазы' }, composition: { ru: 'Конина' } });
    await addToMenu(t, cm.auth, gl, besh, 590_000);
    await addToMenu(t, cm.auth, gv, besh, 630_000);
    await addToMenu(t, cm.auth, gl, plov, 350_000);
    await addToMenu(t, cm.auth, gv, kazy, 520_000, 'GV-KAZY');
  });

  describe('MenuPricing.priceLines', () => {
    it('prices lines by branch menu: base + options, qty, defaults, snapshot data', async () => {
      const [line1, line2] = await pricing.priceLines(gl, [
        { dishId: besh, quantity: 2, modifierOptionIds: [size.options[1]!.id, extras.options[0]!.id] },
        { dishId: plov, quantity: 1, modifierOptionIds: [] },
      ]);
      expect(line1!.basePrice.amount).toBe(590_000);
      expect(line1!.unitPrice.amount).toBe(590_000 + 190_000 + 70_000);
      expect(line1!.lineTotal.amount).toBe(2 * 850_000);
      expect(line1!).toMatchObject({ dishId: besh, dishSlug: 'beshbarmak', categoryId: category, weightGrams: 500, sku: 'POS-1', quantity: 2 });
      expect(line1!.dishName).toEqual({ ru: 'Бешбармак', kk: 'Бешбармақ' });
      expect(line1!.modifiers.map((m) => [m.groupName.ru, m.optionName.ru, m.price.amount])).toEqual([
        ['Размер порции', 'Большая', 190_000],
        ['Добавки', 'Баурсаки, 5 шт.', 70_000],
      ]);
      expect(line2!.lineTotal.amount).toBe(350_000);

      // Цена филиала: то же блюдо в Garden View дороже; обязательная группа -> опция по умолчанию.
      const [gvLine] = await pricing.priceLines(gv, [{ dishId: besh, quantity: 1, modifierOptionIds: [] }]);
      expect(gvLine!.unitPrice.amount).toBe(630_000);
      expect(gvLine!.modifiers.map((m) => m.optionName.ru)).toEqual(['Стандартная']);
      // Код POS филиала переопределяет общий.
      expect((await pricing.priceLines(gv, [{ dishId: kazy, quantity: 1, modifierOptionIds: [] }]))[0]!.sku).toBe('GV-KAZY');
    });

    it('rejects by rules with machine codes', async () => {
      expect(await codeOf(pricing.priceLines(gv, [{ dishId: plov, quantity: 1, modifierOptionIds: [] }]))).toBe('catalog.dish_not_in_branch_menu');
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: 'not-a-uuid', quantity: 1, modifierOptionIds: [] }]))).toBe(
        'catalog.dish_not_in_branch_menu',
      );
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: besh, quantity: 0, modifierOptionIds: [] }]))).toBe('catalog.quantity_invalid');
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: besh, quantity: 100, modifierOptionIds: [] }]))).toBe('catalog.quantity_invalid');
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: besh, quantity: 1.5, modifierOptionIds: [] }]))).toBe('catalog.quantity_invalid');
      expect(
        await codeOf(pricing.priceLines(gl, [{ dishId: plov, quantity: 1, modifierOptionIds: [size.options[0]!.id] }])),
      ).toBe('catalog.modifier_invalid');
      expect(
        await codeOf(pricing.priceLines(gl, [{ dishId: besh, quantity: 1, modifierOptionIds: [size.options[0]!.id, size.options[1]!.id] }])),
      ).toBe('catalog.modifier_invalid');
      expect(await codeOf(pricing.priceLines(gl, Array.from({ length: 201 }, () => ({ dishId: besh, quantity: 1, modifierOptionIds: [] }))))).toBe(
        'catalog.too_many_lines',
      );
      expect(await pricing.priceLines(gl, [])).toEqual([]);

      const o = await owner(t);
      await setAvailability(t, o.auth, gl, besh, { available: false });
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: besh, quantity: 1, modifierOptionIds: [] }]))).toBe('catalog.dish_unavailable');

      // Неактивная категория — блюда нет в меню.
      await t.http().put(`${API}/admin/catalog/categories/${category}`).set('authorization', cm.auth).send({ name: { ru: 'Казахская кухня' }, isActive: false });
      expect(await codeOf(pricing.priceLines(gl, [{ dishId: plov, quantity: 1, modifierOptionIds: [] }]))).toBe('catalog.dish_not_in_branch_menu');
    });
  });

  describe('MenuPricing.checkAvailability', () => {
    it('soft check respects branch stopListMode and expired stops', async () => {
      const o = await owner(t);
      await setAvailability(t, o.auth, gl, besh, { available: false, until: new Date(t.clock.now().getTime() + 3_600_000).toISOString() });
      await setAvailability(t, o.auth, gv, besh, { available: false });
      expect(await pricing.checkAvailability(gl, [besh, plov, kazy, 'garbage'])).toEqual({
        [besh]: 'stopped_shown',
        [plov]: 'available',
        [kazy]: 'not_in_menu',
        garbage: 'not_in_menu',
      });
      expect(await pricing.checkAvailability(gv, [besh, kazy])).toEqual({ [besh]: 'stopped_hidden', [kazy]: 'available' });
      t.clock.advance(3_600_000);
      expect((await pricing.checkAvailability(gl, [besh]))[besh]).toBe('available');
      expect(await pricing.checkAvailability('0192f0c8-0000-7000-8000-000000000000', [besh])).toEqual({ [besh]: 'not_in_menu' });
    });
  });

  describe('MenuQuery', () => {
    it('searches branch dishes (full-text ru/kk, partial) including stopped ones', async () => {
      const o = await owner(t);
      await setAvailability(t, o.auth, gl, plov, { available: false });
      const partial = await query.searchBranchDishes(gl, 'бешб');
      expect(partial.map((d) => d.dishId)).toEqual([besh]);
      expect(partial[0]).toMatchObject({ slug: 'beshbarmak', categoryId: category, price: { amount: 590_000 }, availability: 'available', weightGrams: 500 });
      // Стемминг по составу: «бараниной» находит «баранина».
      expect((await query.searchBranchDishes(gl, 'с бараниной')).map((d) => d.dishId).sort()).toEqual([besh, plov].sort());
      expect((await query.searchBranchDishes(gl, 'палау')).map((d) => [d.dishId, d.availability])).toEqual([[plov, 'stopped_shown']]);
      expect((await query.searchBranchDishes(gv, 'қазы')).map((d) => d.dishId)).toEqual([kazy]);
      expect(await query.searchBranchDishes(gv, 'палау')).toEqual([]);
      expect((await query.searchBranchDishes(gl, '', 1)).length).toBe(1);
    });

    it('returns dishes of the branch menu in requested order, skipping unknown', async () => {
      const list = await query.getDishes(gl, [plov, kazy, besh, 'x']);
      expect(list.map((d) => [d.dishId, d.price.amount])).toEqual([
        [plov, 350_000],
        [besh, 590_000],
      ]);
      expect(await query.getDishes('bad', [besh])).toEqual([]);
    });

    it('describes dishes regardless of the branch menu and stop-list (problem lines of a cart)', async () => {
      const o = await owner(t);
      await setAvailability(t, o.auth, gv, besh, { available: false });
      const cards = await query.describeDishes([kazy, besh, 'x', '01a0d872-0000-7000-8000-000000000000', besh]);
      expect(cards.map((c) => [c.dishId, c.name.ru])).toEqual([
        [kazy, 'Казы'],
        [besh, 'Бешбармак'],
      ]);
      expect(cards[1]).toMatchObject({ slug: 'beshbarmak', photoUrl: null, weightGrams: 500 });
      expect(await query.describeDishes([])).toEqual([]);
    });

    it('branch order menu: all dishes of the branch with modifiers, stopped ones flagged even in hide mode', async () => {
      const o = await owner(t);
      await setAvailability(t, o.auth, gv, besh, { available: false, reason: 'Нет конины' });
      const menu = await query.branchOrderMenu(gv);
      expect(menu.branchId).toBe(gv);
      expect(menu.categories).toEqual([{ id: category, slug: expect.any(String), name: expect.objectContaining({ ru: 'Казахская кухня' }) }]);
      expect(menu.dishes.map((d) => [d.dishId, d.stopped, d.availability])).toEqual([
        [besh, true, 'stopped_hidden'],
        [kazy, false, 'available'],
      ]);
      const b = menu.dishes[0]!;
      expect(b).toMatchObject({ price: { amount: 630_000 }, stopReason: 'Нет конины', stoppedUntil: null, sku: 'POS-1' });
      expect(b.modifierGroups.map((g) => [g.id, g.isRequired, g.options.length])).toEqual([
        [size.id, true, 2],
        [extras.id, false, 2],
      ]);
      expect(b.modifierGroups[0]!.options[1]).toMatchObject({ id: size.options[1]!.id, price: { amount: 190_000 }, isDefault: false });
      expect(menu.dishes[1]).toMatchObject({ sku: 'GV-KAZY', stopReason: null, modifierGroups: [] });
      expect(await codeOf(query.branchOrderMenu('01a0d872-0000-7000-8000-000000000000'))).toBe('branch.not_found');
    });
  });

  describe('StopListControl', () => {
    it('POS sync stops/restores idempotently, skips unknown POS items, audits as system', async () => {
      await RequestContext.runAsSystem('job:pos.sync', () => stopList.setAvailability(gl, besh, false, 'pos'));
      await RequestContext.runAsSystem('job:pos.sync', () => stopList.setAvailability(gl, besh, false, 'pos'));
      expect((await pricing.checkAvailability(gl, [besh]))[besh]).toBe('stopped_shown');
      const audit = await auditRows(t, 'menu.stop_list_changed');
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ actor_kind: 'system', meta: { source: 'pos' }, after: { stopSource: 'pos' } });
      expect(await publishedEvents(t, CatalogEvents.StopListChanged)).toEqual([
        { branchId: gl, dishId: besh, availability: 'stopped_shown', source: 'pos', stoppedUntil: null, reason: null },
      ]);

      await stopList.setAvailability(gl, besh, true, 'pos');
      expect((await pricing.checkAvailability(gl, [besh]))[besh]).toBe('available');

      // Позиция POS, которой нет в меню сайта, пропускается; ручной вызов — ошибка.
      await expect(stopList.setAvailability(gv, plov, false, 'pos')).resolves.toBeUndefined();
      expect(await codeOf(stopList.setAvailability(gv, plov, false, 'manual'))).toBe('catalog.dish_not_in_branch_menu');
    });

    it('finds dishes by POS code: global code, unambiguous branch override, per-branch lookup', async () => {
      expect(await stopList.findDishIdBySku('POS-1')).toBe(besh);
      expect(await stopList.findDishIdBySku(' POS-1 ')).toBe(besh);
      expect(await stopList.findDishIdBySku('GV-KAZY')).toBe(kazy);
      expect(await stopList.findDishIdBySku('UNKNOWN')).toBeNull();
      expect(await stopList.findDishIdBySku('bad sku!')).toBeNull();
      expect(await stopList.findDishIdBySkuInBranch(gv, 'GV-KAZY')).toBe(kazy);
      expect(await stopList.findDishIdBySkuInBranch(gl, 'GV-KAZY')).toBeNull();
      expect(await stopList.findDishIdBySkuInBranch(gl, 'POS-1')).toBe(besh);
    });
  });
});
