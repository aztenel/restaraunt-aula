import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createE2eApp, deliveries, E2eContext, feed, outboxEvents, pendingOutbox, sandboxPay } from './support/e2e-app';
import { advanceOrder, placeOrder, storefrontMenu, tracking } from './support/ordering';

/**
 * Дополнительно: POS как внешняя система (iiko, сеть подменена). Ordering → POS (передача принятого заказа
 * на кухню по сопоставлениям) и POS → Catalog (стоп-лист кассы скрывает блюдо на витрине и в расчёте корзины).
 * Заказ без сопоставления не блокируется: кухня работает по экрану админки, персонал оповещён.
 */
describe('E2E extra: POS (iiko) ↔ Ordering ↔ Catalog', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  async function paidOrder(dishId: string) {
    const placed = await placeOrder(ctx, { branchId: ctx.seed.branches.greenline, type: 'pickup', items: [{ dishId, quantity: 2 }], paymentMethod: 'online' });
    await ctx.drain();
    await sandboxPay(ctx, (await tracking(ctx, placed.publicToken)).payment.current.paymentUrl);
    await ctx.drain();
    return placed;
  }

  it('accepted order is pushed to iiko by mapping; POS stop-list hides the dish on the storefront; unmapped dish → missing_mapping alert, order continues', async () => {
    const { greenline } = ctx.seed.branches;
    const admin = await ctx.staff([{ role: 'sysadmin' }], 'Администратор');
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL', { phone: '+77010000555' });
    await ctx.configureIntegration('pos.iiko', {
      enabled: true,
      config: { baseUrl: 'https://iiko.test', branches: { [greenline]: { organizationId: 'org-gl', terminalGroupId: 'tg-gl' } } },
      secrets: { apiLogin: 'iiko-api-login-secret' },
    });
    await ctx.configureIntegration('pos.routing', { enabled: true, config: { default: 'manual', branches: { [greenline]: 'iiko' } } });
    ctx.net.on('access_token', 200, { correlationId: 'c', token: 'iiko-token' });
    ctx.net.on('deliveries/create', 200, { correlationId: 'c', orderInfo: { id: 'iiko-order-1', creationStatus: 'Success' } });
    ctx.net.on('stop_lists', 200, {
      terminalGroupStopLists: [{ organizationId: 'org-gl', items: [{ terminalGroupId: 'tg-gl', items: [{ productId: 'p-sorpa', balance: 0 }, { productId: 'p-kazy', balance: 5 }] }] }],
    });

    const menu = await storefrontMenu(ctx, 'greenline');
    const kazy = menu.get('kazy')!;
    const sorpa = menu.get('sorpa')!;
    const achichuk = menu.get('achichuk')!;
    for (const [dishId, externalProductId] of [
      [kazy.id, 'p-kazy'],
      [sorpa.id, 'p-sorpa'],
    ]) {
      await ctx.api().post('/api/v1/admin/pos/mappings').set('Authorization', admin.auth).send({ branchId: greenline, dishId, externalProductId }).expect(201);
    }

    // ---------------------------------------------------------------- Заказ с сопоставленным блюдом → iiko
    const order = await paidOrder(kazy.id);
    await advanceOrder(ctx, order.orderId, operator.auth, 'accepted');
    await ctx.drain();
    const push = ctx.net.requests.find((r) => r.url.includes('deliveries/create'))!;
    expect(push).toBeTruthy();
    const body = JSON.parse(push.body!);
    expect(JSON.stringify(body)).toContain('p-kazy');
    expect(JSON.stringify(body)).toContain('org-gl');
    const exported = await ctx.api().get('/api/v1/admin/pos/exports').query({ orderId: order.orderId }).set('Authorization', operator.auth).expect(200);
    expect(exported.body.items).toEqual([expect.objectContaining({ provider: 'iiko', status: 'sent', posOrderId: 'iiko-order-1', confirmedAt: expect.any(String) })]);
    expect((await outboxEvents(ctx, 'pos.order_sent')).map((e) => e.payload)).toEqual([
      expect.objectContaining({ orderId: order.orderId, branchId: greenline, provider: 'iiko', posOrderId: 'iiko-order-1' }),
    ]);

    // ---------------------------------------------------------------- Заказ с несопоставленным блюдом: не блокируется
    const unmapped = await paidOrder(achichuk.id);
    await advanceOrder(ctx, unmapped.orderId, operator.auth, 'accepted');
    await ctx.drain();
    const failed = await ctx.api().get('/api/v1/admin/pos/exports').query({ orderId: unmapped.orderId }).set('Authorization', operator.auth).expect(200);
    expect(failed.body.items).toEqual([
      expect.objectContaining({ status: 'failed', failureReason: 'missing_mapping', missingMappings: expect.arrayContaining([expect.objectContaining({ dishId: achichuk.id })]) }),
    ]);
    expect((await outboxEvents(ctx, 'pos.order_failed')).map((e) => [e.payload.orderId, e.payload.reason])).toEqual([[unmapped.orderId, 'missing_mapping']]);
    expect((await feed(ctx, operator.auth)).some((f) => f.entityId === unmapped.orderId && f.sound)).toBe(true);
    expect((await deliveries(ctx, { audience: 'staff' })).some((d) => d.recipientName === 'Оператор GL' && d.template === 'staff.system_alert')).toBe(true);
    await advanceOrder(ctx, unmapped.orderId, operator.auth, 'cooking'); // кухня работает по экрану админки

    // ---------------------------------------------------------------- Стоп-лист кассы → витрина и расчёт корзины
    await ctx.api().post('/api/v1/admin/pos/stop-list/sync').set('Authorization', operator.auth).send({ branchId: greenline }).expect(202);
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    const after = await storefrontMenu(ctx, 'greenline');
    expect(after.get('sorpa')?.available ?? false).toBe(false);
    expect(after.get('kazy')!.available).toBe(true);
    const stopList = await ctx.api().get(`/api/v1/admin/catalog/branches/${greenline}/stop-list`).set('Authorization', await ctx.owner()).expect(200);
    expect(JSON.stringify(stopList.body)).toContain(sorpa.id);
    const quote = await ctx.api().post('/api/v1/public/orders/quote').send({ branchId: greenline, type: 'pickup', items: [{ dishId: sorpa.id, quantity: 1 }] }).expect(200);
    expect(quote.body).toMatchObject({ canCheckout: false });
    expect(quote.body.lines[0].problem).toBe('catalog.dish_unavailable');
    // Другой филиал (manual) не затронут.
    expect((await storefrontMenu(ctx, 'garden-view')).get('sorpa')!.available).toBe(true);
  });
});
