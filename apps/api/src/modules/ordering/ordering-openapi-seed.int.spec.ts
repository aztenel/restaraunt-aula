import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../shared/infrastructure/http/swagger';
import { newId } from '../../shared/kernel/ids';
import { DeliveryQueries } from './application/delivery.queries';
import { DeliveryZoneRepository } from './infrastructure/delivery-zone.repository';
import { PromoCodeRepository } from './infrastructure/promo-code.repository';
import { seedOrdering, WELCOME_PROMO_CODE } from './infrastructure/seed';
import { addDish, checkoutBody, createOrderingTestApp, OrderingTestContext, setupBranch } from './testing/ordering-test-kit';
import { BranchRepository } from '../identity/infrastructure/branch.repository';
import { BranchDirectoryService } from '../identity/application/directories';

describe('Ordering: OpenAPI and seed (integration)', () => {
  let ctx: OrderingTestContext;

  beforeAll(async () => {
    ctx = await createOrderingTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => ctx.reset());

  it('describes every endpoint with typed schemas for the generated client', () => {
    const doc = buildOpenApiDocument(ctx.t.app, 'test');
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/public/orders/quote',
        '/api/v1/public/orders',
        '/api/v1/public/orders/{publicToken}',
        '/api/v1/public/orders/{publicToken}/pay',
        '/api/v1/public/delivery/resolve',
        '/api/v1/public/branches/{branchId}/delivery-zones',
        '/api/v1/public/branches/{branchId}/order-slots',
        '/api/v1/admin/orders',
        '/api/v1/admin/orders/queue',
        '/api/v1/admin/orders/quote',
        '/api/v1/admin/orders/{id}',
        '/api/v1/admin/orders/{id}/transition',
        '/api/v1/admin/orders/{id}/reject',
        '/api/v1/admin/orders/{id}/cancel',
        '/api/v1/admin/orders/{id}/refund',
        '/api/v1/admin/orders/{id}/courier/retry',
        '/api/v1/admin/orders/{id}/courier/cancel',
        '/api/v1/admin/delivery-zones',
        '/api/v1/admin/delivery-zones/{id}',
        '/api/v1/admin/promo-codes',
        '/api/v1/admin/promo-codes/{id}',
      ]),
    );
    const schemas = doc.components?.schemas ?? {};
    for (const name of ['OrderQuoteDto', 'OrderCheckoutDto', 'OrderCheckoutResultDto', 'OrderTrackingDto', 'AdminOrderDetailsDto', 'AdminOrderQueueDto', 'DeliveryZoneDto', 'PromoCodeDto']) {
      expect(schemas[name], name).toBeTruthy();
    }
    expect((schemas.OrderQuoteDto as any).properties.total.$ref).toContain('MoneyDto');
    expect(doc.paths['/api/v1/admin/orders']!.get!.tags).toEqual(['admin']);
    expect(doc.paths['/api/v1/admin/orders']!.get!.security).toEqual([{ staff: [] }]);
    expect(doc.paths['/api/v1/public/orders']!.post!.tags).toEqual(['public']);
    expect(doc.paths['/api/v1/public/orders/{publicToken}']!.get!.parameters?.map((p: any) => p.name)).toContain('locale');
  });

  it('demo seed: two non-overlapping zones around each branch and WELCOME10, idempotent', async () => {
    const greenline = await setupBranch(ctx, {}, 'GL');
    const garden = await setupBranch(ctx, {}, 'GV');
    const repo = ctx.t.get(BranchRepository);
    const gl = (await repo.findById(greenline))!;
    await repo.update(greenline, { ...gl, location: { lat: 51.0762, lng: 71.4125 } });
    ctx.t.get(BranchDirectoryService).invalidate();
    const seedContext = (demo: boolean) => ({
      app: ctx.t.app,
      branches: { greenline, 'garden-view': garden },
      legalEntityId: newId(),
      ownerUserId: newId(),
      demo,
      log: () => undefined,
    });
    await seedOrdering(seedContext(false));
    expect(await ctx.t.get(DeliveryZoneRepository).listForBranches('all')).toEqual([]);

    await seedOrdering(seedContext(true));
    await seedOrdering(seedContext(true));
    const zones = ctx.t.get(DeliveryZoneRepository);
    for (const branchId of [greenline, garden]) {
      const list = await zones.listForBranch(branchId);
      expect(list.map((z) => [z.name.ru, z.deliveryFee.amount, z.minOrderAmount.amount])).toEqual([
        ['Ближняя зона', 50_000, 300_000],
        ['Дальняя зона', 100_000, 500_000],
      ]);
    }
    const promo = await ctx.t.get(PromoCodeRepository).findByCode(WELCOME_PROMO_CODE);
    expect(promo).toMatchObject({ kind: 'percent', percentBp: 1_000, perPhoneLimit: 1, branchId: null, isActive: true });

    const delivery = ctx.t.get(DeliveryQueries);
    // Рядом с GreenLine: обе ближние зоны по 500 ₸ — выбирается ближайший филиал.
    const near = await delivery.resolve({ lat: 51.077, lng: 71.412 });
    expect(near.best).toMatchObject({ branch: { id: greenline }, zone: { name: { ru: 'Ближняя зона' } } });
    // 4 км к северу от Garden View: ближняя зона GV не достаёт, но дальняя зона дороже ближней.
    const far = await delivery.resolve({ lat: 51.125, lng: 71.4187 });
    expect(far.best?.zone.name.ru).toBe('Дальняя зона');
    expect((await delivery.resolve({ lat: 51.3, lng: 71.9 })).deliverable).toBe(false);

    // Промокод работает при оформлении: 10%, один раз на телефон.
    const dish = addDish(ctx, 'Плов', 5_000);
    const body = checkoutBody(garden, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', promoCode: 'welcome10' });
    const first = await ctx.t.http().post('/api/v1/public/orders').send(body).expect(201);
    expect(first.body.total).toEqual({ amount: 450_000, currency: 'KZT' });
    const again = await ctx.t.http().post('/api/v1/public/orders').send({ ...body, idempotencyKey: newId() }).expect(422);
    expect(again.body.error.code).toBe('promo.phone_limit_reached');
  });
});
