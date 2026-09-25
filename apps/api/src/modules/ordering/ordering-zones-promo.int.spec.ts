import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BranchRepository } from '../identity/infrastructure/branch.repository';
import { BranchDirectoryService } from '../identity/application/directories';
import { GeoPoint } from '../../shared/kernel/geo';
import { Money } from '../../shared/kernel/money';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import {
  addDish,
  addPromo,
  addZone,
  auditActions,
  BRANCH_LOCATION,
  checkoutBody,
  createOrderingTestApp,
  OrderingTestContext,
  setupBranch,
  square,
  staff,
} from './testing/ordering-test-kit';

describe('Ordering: delivery zones, branch resolution, slots and promo codes (integration)', () => {
  let ctx: OrderingTestContext;
  let branchA: string;
  let branchB: string;

  beforeAll(async () => {
    ctx = await createOrderingTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await ctx.reset();
    branchA = await setupBranch(ctx, {}, 'AAA');
    branchB = await setupBranch(ctx, {}, 'BBB');
  });

  const api = () => ctx.t.http();

  function zoneBody(branchId: string, polygon: GeoPoint[], overrides: Record<string, unknown> = {}) {
    return {
      branchId,
      name: { ru: 'Центр', kk: 'Орталық' },
      polygon,
      minOrderAmount: { amount: 300_000 },
      deliveryFee: { amount: 50_000 },
      freeDeliveryFrom: { amount: 1_500_000 },
      etaMinutes: 45,
      ...overrides,
    };
  }

  async function moveBranch(branchId: string, location: GeoPoint) {
    const repo = ctx.t.get(BranchRepository);
    const current = (await repo.findById(branchId))!;
    await repo.update(branchId, { ...current, location });
    ctx.t.get(BranchDirectoryService).invalidate();
  }

  describe('delivery zones', () => {
    it('CRUD with branch permission; zones of one branch must not overlap, touching is allowed', async () => {
      const managerA = await staff(ctx, 'branch_manager', branchA);
      const operatorA = await staff(ctx, 'branch_operator', branchA);
      const west = square({ lat: 51.09, lng: 71.40 }, 0.01);
      const created = await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchA, west)).expect(201);
      expect(created.body).toMatchObject({ branchId: branchA, name: { ru: 'Центр' }, deliveryFee: { amount: 50_000 }, isActive: true });
      await api().post('/api/v1/admin/delivery-zones').set('Authorization', operatorA).send(zoneBody(branchA, west)).expect(403);
      await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchB, west)).expect(403);

      const overlapping = square({ lat: 51.095, lng: 71.405 }, 0.01);
      const conflict = await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchA, overlapping)).expect(409);
      expect(conflict.body.error).toMatchObject({ code: 'delivery_zone.overlap', details: { conflictingZoneId: created.body.id } });
      // Касание по границе допустимо (зоны «стык в стык»).
      const east = square({ lat: 51.09, lng: 71.42 }, 0.01);
      const touching = await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchA, east)).expect(201);
      // Другой филиал может перекрывать зоны первого.
      const owner = await staff(ctx, 'owner');
      await api().post('/api/v1/admin/delivery-zones').set('Authorization', owner).send(zoneBody(branchB, overlapping)).expect(201);

      const moved = await api()
        .put(`/api/v1/admin/delivery-zones/${touching.body.id}`)
        .set('Authorization', managerA)
        .send({ ...zoneBody(branchA, overlapping), branchId: undefined })
        .expect(409);
      expect(moved.body.error.code).toBe('delivery_zone.overlap');
      const updated = await api()
        .put(`/api/v1/admin/delivery-zones/${touching.body.id}`)
        .set('Authorization', managerA)
        .send({ ...zoneBody(branchA, east, { deliveryFee: { amount: 70_000 }, isActive: false }), branchId: undefined })
        .expect(200);
      expect(updated.body).toMatchObject({ deliveryFee: { amount: 70_000 }, isActive: false });

      const selfIntersecting = [
        { lat: 51.2, lng: 71.2 },
        { lat: 51.3, lng: 71.3 },
        { lat: 51.2, lng: 71.3 },
        { lat: 51.3, lng: 71.2 },
      ];
      const invalid = await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchA, selfIntersecting)).expect(422);
      expect(invalid.body.error.code).toBe('geo.polygon_self_intersecting');

      const list = await api().get('/api/v1/admin/delivery-zones').set('Authorization', managerA).expect(200);
      expect(list.body.map((z: { id: string }) => z.id).sort()).toEqual([created.body.id, touching.body.id].sort());
      await api().get(`/api/v1/admin/delivery-zones?branchId=${branchB}`).set('Authorization', managerA).expect(403);

      await api().delete(`/api/v1/admin/delivery-zones/${created.body.id}`).set('Authorization', managerA).expect(204);
      // Удалённая зона не мешает нарисовать зону на её месте.
      await api().post('/api/v1/admin/delivery-zones').set('Authorization', managerA).send(zoneBody(branchA, west)).expect(201);
      await api().get(`/api/v1/admin/delivery-zones/${created.body.id}`).set('Authorization', managerA).expect(404);
      expect(await auditActions(ctx.t, touching.body.id)).toEqual(['delivery_zone.created', 'delivery_zone.updated']);
      expect(await auditActions(ctx.t, created.body.id)).toEqual(['delivery_zone.created', 'delivery_zone.deleted']);

      const publicZones = await api().get(`/api/v1/public/branches/${branchA}/delivery-zones?locale=kk`).expect(200);
      expect(publicZones.body).toHaveLength(1);
      expect(publicZones.body[0]).toMatchObject({ name: 'Орталық', polygon: expect.any(Array), minOrderAmount: { amount: 300_000 } });
    });

    it('resolves the branch by a map point: lowest fee first, then the nearest branch', async () => {
      const point = { lat: 51.1, lng: 71.42 };
      const resolve = async (p = point) => (await api().post('/api/v1/public/delivery/resolve?locale=ru').send({ point: p, address: 'ул. Сыганак, 10' }).expect(200)).body;
      expect(await resolve()).toEqual({ deliverable: false, address: 'ул. Сыганак, 10', best: null, alternatives: [] });

      await addZone(ctx, branchA, { deliveryFee: Money.tenge(700) });
      const zoneB = await addZone(ctx, branchB, { deliveryFee: Money.tenge(500) });
      let result = await resolve();
      expect(result).toMatchObject({ deliverable: true, best: { branch: { id: branchB }, zone: { id: zoneB.id, deliveryFee: { amount: 50_000 } } } });
      expect(result.alternatives.map((a: { branch: { id: string } }) => a.branch.id)).toEqual([branchA]);

      // Равная стоимость — ближайший филиал.
      await api()
        .put(`/api/v1/admin/delivery-zones/${zoneB.id}`)
        .set('Authorization', await staff(ctx, 'owner'))
        .send({
          name: { ru: 'Зона' },
          polygon: square(BRANCH_LOCATION, 0.05),
          minOrderAmount: { amount: 300_000 },
          deliveryFee: { amount: 70_000 },
          etaMinutes: 45,
        })
        .expect(200);
      await moveBranch(branchA, { lat: 51.099, lng: 71.419 });
      await moveBranch(branchB, { lat: 51.06, lng: 71.39 });
      result = await resolve();
      expect(result.best.branch.id).toBe(branchA);
      expect(result.best.distanceMeters).toBeLessThan(result.alternatives[0].distanceMeters);

      // Филиал без доставки не участвует.
      const repo = ctx.t.get(BranchRepository);
      const a = (await repo.findById(branchA))!;
      await repo.update(branchA, { ...a, settings: { ...a.settings, acceptsDelivery: false } });
      ctx.t.get(BranchDirectoryService).invalidate();
      result = await resolve();
      expect(result.best.branch.id).toBe(branchB);
      expect(result.alternatives).toEqual([]);
      await api().post('/api/v1/public/delivery/resolve').send({ point: { lat: 95, lng: 71 } }).expect(400);
    });
  });

  describe('order time', () => {
    it('ASAP availability and 15-minute slots within opening hours after the lead time', async () => {
      const res = await api().get(`/api/v1/public/branches/${branchA}/order-slots?type=pickup`).expect(200);
      expect(res.body).toMatchObject({ branchId: branchA, type: 'pickup', date: '2026-10-01', timezone: 'Asia/Almaty', leadMinutes: 30 });
      expect(res.body.asap.available).toBe(true);
      expect(res.body.slots[0]).toEqual({ at: zonedTimeToUtc('2026-10-01', '11:30', 'Asia/Almaty').toISOString(), time: '11:30' });
      expect(res.body.slots[1].time).toBe('11:45');
      // Последний слот — до закрытия в полночь (00:00 — уже следующие сутки).
      expect(res.body.slots.at(-1).time).toBe('23:45');
      expect(res.body.dates).toHaveLength(8);

      const tomorrow = await api().get(`/api/v1/public/branches/${branchA}/order-slots?type=delivery&date=2026-10-02&locale=kk`).expect(200);
      expect(tomorrow.body.slots[0].time).toBe('11:00');
      const beyond = await api().get(`/api/v1/public/branches/${branchA}/order-slots?type=delivery&date=2026-10-20`).expect(200);
      expect(beyond.body.slots).toEqual([]);
      await api().get(`/api/v1/public/branches/${branchA}/order-slots?type=delivery&date=01.10.2026`).expect(400);
      await api().get(`/api/v1/public/branches/${branchA}/order-slots`).expect(400);

      ctx.t.clock.set(zonedTimeToUtc('2026-10-02', '02:00', 'Asia/Almaty'));
      const closed = await api().get(`/api/v1/public/branches/${branchA}/order-slots?type=pickup`).expect(200);
      expect(closed.body.asap).toEqual({ available: false, reason: 'closed', readyAt: null });

      const noPickup = await setupBranch(ctx, { acceptsPickup: false });
      const denied = await api().get(`/api/v1/public/branches/${noPickup}/order-slots?type=pickup`).expect(422);
      expect(denied.body.error.code).toBe('order.type_not_accepted');
    });
  });

  describe('promo codes', () => {
    const promoBody = (overrides: Record<string, unknown> = {}) => ({ code: 'autumn-5', kind: 'fixed', fixedAmount: { amount: 50_000 }, ...overrides });

    it('branch manager manages promo codes of own branch only; global promo codes need a global role', async () => {
      const managerA = await staff(ctx, 'branch_manager', branchA);
      const content = await staff(ctx, 'content_manager');
      const own = await api().post('/api/v1/admin/promo-codes').set('Authorization', managerA).send(promoBody({ branchId: branchA })).expect(201);
      expect(own.body).toMatchObject({ code: 'AUTUMN-5', kind: 'fixed', fixedAmount: { amount: 50_000 }, branchId: branchA, editable: true });
      const badCode = await api().post('/api/v1/admin/promo-codes').set('Authorization', managerA).send(promoBody({ code: 'B1', branchId: branchA })).expect(422);
      expect(badCode.body.error.code).toBe('promo.invalid_code_format');
      await api().post('/api/v1/admin/promo-codes').set('Authorization', managerA).send(promoBody({ code: 'BBB1', branchId: branchB })).expect(403);
      await api().post('/api/v1/admin/promo-codes').set('Authorization', managerA).send(promoBody({ code: 'NET1' })).expect(403);
      const global = await api().post('/api/v1/admin/promo-codes').set('Authorization', content).send(promoBody({ code: 'NET1', kind: 'percent', percentBp: 1_500, fixedAmount: undefined })).expect(201);
      const duplicate = await api().post('/api/v1/admin/promo-codes').set('Authorization', content).send(promoBody({ code: 'net1' })).expect(409);
      expect(duplicate.body.error.code).toBe('promo.duplicate_code');
      const invalid = await api().post('/api/v1/admin/promo-codes').set('Authorization', content).send({ code: 'BAD1', kind: 'percent' }).expect(422);
      expect(invalid.body.error.code).toBe('promo.invalid_percent');

      const listed = await api().get('/api/v1/admin/promo-codes').set('Authorization', managerA).expect(200);
      expect(listed.body.items.map((p: { code: string; editable: boolean }) => [p.code, p.editable]).sort()).toEqual([
        ['AUTUMN-5', true],
        ['NET1', false],
      ]);
      const codes = async (query: string) =>
        (await api().get(`/api/v1/admin/promo-codes?${query}`).set('Authorization', managerA).expect(200)).body.items.map((p: { code: string }) => p.code);
      expect(await codes('scope=network')).toEqual(['NET1']);
      expect(await codes('scope=branch')).toEqual(['AUTUMN-5']);
      expect(await codes(`scope=branch&branchId=${branchA}`)).toEqual(['AUTUMN-5']);
      // Сетевые промокоды не относятся к филиалу: фильтр филиала при scope=network не применяется.
      expect(await codes(`scope=network&branchId=${branchA}`)).toEqual(['NET1']);
      await api().get('/api/v1/admin/promo-codes?scope=all').set('Authorization', managerA).expect(400);
      await api().put(`/api/v1/admin/promo-codes/${global.body.id}`).set('Authorization', managerA).send(promoBody({ code: 'NET1' })).expect(403);
      await api().delete(`/api/v1/admin/promo-codes/${global.body.id}`).set('Authorization', managerA).expect(403);
      const updated = await api()
        .put(`/api/v1/admin/promo-codes/${own.body.id}`)
        .set('Authorization', managerA)
        .send(promoBody({ branchId: branchA, fixedAmount: { amount: 70_000 }, isActive: false }))
        .expect(200);
      expect(updated.body).toMatchObject({ fixedAmount: { amount: 70_000 }, isActive: false });
      const active = await api().get('/api/v1/admin/promo-codes?active=true').set('Authorization', content).expect(200);
      expect(active.body.items.map((p: { code: string }) => p.code)).toEqual(['NET1']);
      await api().delete(`/api/v1/admin/promo-codes/${own.body.id}`).set('Authorization', managerA).expect(204);
      await api().get(`/api/v1/admin/promo-codes/${own.body.id}`).set('Authorization', managerA).expect(404);
      expect(await auditActions(ctx.t, own.body.id)).toEqual(['promo_code.created', 'promo_code.updated', 'promo_code.deleted']);
      const operator = await staff(ctx, 'branch_operator', branchA);
      await api().get('/api/v1/admin/promo-codes').set('Authorization', operator).expect(403);
    });

    it('limits: total, per phone, branch restriction, minimal subtotal and validity period', async () => {
      const dish = addDish(ctx, 'Плов', 5_000);
      const order = (promoCode: string, overrides: Record<string, unknown> = {}) =>
        api()
          .post('/api/v1/public/orders')
          .send(checkoutBody((overrides.branchId as string) ?? branchA, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', promoCode, ...overrides }));

      await addPromo(ctx, { code: 'ONCE', totalLimit: 1 });
      const first = await order('ONCE').expect(201);
      const second = await order('ONCE', { customer: { name: 'Другой', phone: '+77010000002' } }).expect(422);
      expect(second.body.error.code).toBe('promo.total_limit_reached');
      // Отмена до оплаты освобождает использование.
      const operator = await staff(ctx, 'branch_operator', branchA);
      await api().post(`/api/v1/admin/orders/${first.body.orderId}/cancel`).set('Authorization', operator).send({ reasonCode: 'guest_request' }).expect(200);
      await order('ONCE', { customer: { name: 'Другой', phone: '+77010000002' } }).expect(201);

      await addPromo(ctx, { code: 'WELCOME10', perPhoneLimit: 1 });
      await order('WELCOME10').expect(201);
      const samePhone = await order('WELCOME10', { customer: { name: 'Айгерим', phone: '8 701 123 45 67' } }).expect(422);
      expect(samePhone.body.error.code).toBe('promo.phone_limit_reached');
      const quote = await api()
        .post('/api/v1/public/orders/quote')
        .send({ branchId: branchA, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 1 }], promoCode: 'WELCOME10', phone: '+77011234567' })
        .expect(200);
      expect(quote.body.promo).toMatchObject({ applied: false, reason: 'promo.phone_limit_reached' });
      await order('WELCOME10', { customer: { name: 'Новый', phone: '+77010000003' } }).expect(201);

      await addPromo(ctx, { code: 'ONLYB', branchId: branchB });
      expect((await order('ONLYB').expect(422)).body.error.code).toBe('promo.wrong_branch');
      await order('ONLYB', { branchId: branchB }).expect(201);

      await addPromo(ctx, { code: 'BIG', minSubtotal: Money.tenge(10_000) });
      const small = await order('BIG').expect(422);
      expect(small.body.error).toMatchObject({ code: 'promo.min_subtotal', details: { minSubtotal: { amount: 1_000_000 } } });

      await addPromo(ctx, { code: 'OLD', validTo: new Date('2026-09-30T00:00:00Z') });
      expect((await order('OLD').expect(422)).body.error.code).toBe('promo.expired');
      await addPromo(ctx, { code: 'SOON', validFrom: new Date('2026-12-01T00:00:00Z') });
      expect((await order('SOON').expect(422)).body.error.code).toBe('promo.not_started');
      await addPromo(ctx, { code: 'OFF', isActive: false });
      expect((await order('OFF').expect(422)).body.error.code).toBe('promo.inactive');
    });
  });
});
