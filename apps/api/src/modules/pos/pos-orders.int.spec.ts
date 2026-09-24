import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch, tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { newId } from '../../shared/kernel/ids';
import { OrderCancelledPayload, OrderingEvents } from '../ordering/public';
import { ProductMappingRepository } from './infrastructure/product-mapping.repository';
import { PosEvents } from './public';
import { createPosTestApp, kitchenOrder, ORG_ID, PosTestContext, publishAccepted, routeToIiko, TERMINAL_GROUP_ID } from './testing/pos-test-app';

describe('POS: передача заказов на кухню (integration)', () => {
  let ctx: PosTestContext;
  let t: TestApp;

  beforeAll(async () => {
    ctx = await createPosTestApp();
    t = ctx.t;
  });
  afterAll(async () => t.close());
  beforeEach(async () => ctx.reset());

  const db = () => t.database.rootConnection();

  async function exportOf(orderId: string) {
    const rows = await sql<any>`select * from pos.order_exports where order_id = ${orderId}`.execute(db());
    return rows.rows[0];
  }

  async function outbox(topic: string): Promise<any[]> {
    const rows = await sql<{ payload: any }>`select payload from platform.outbox where topic = ${topic} order by created_at`.execute(db());
    return rows.rows.map((r) => r.payload.payload);
  }

  async function failedJobs(): Promise<number> {
    const rows = await sql<{ n: string }>`select count(*) as n from platform.failed_jobs`.execute(db());
    return Number(rows.rows[0]!.n);
  }

  async function mapDish(branchId: string, dishId: string, externalProductId: string, modifiers: Record<string, { externalProductId: string; externalGroupId: string | null }> = {}) {
    await t.get(ProductMappingRepository).insert({
      id: newId(),
      branchId,
      dishId,
      provider: 'iiko',
      externalProductId,
      externalName: null,
      modifiers,
      now: t.clock.now(),
    });
  }

  function item(dishId: string, name: string, quantity = 1, modifiers: Array<{ optionId: string; name: string }> = []) {
    return {
      dishId,
      sku: null,
      name: { ru: name, kk: name },
      quantity,
      modifiers: modifiers.map((m) => ({ optionId: m.optionId, name: { ru: m.name } })),
      unitPrice: { amount: 250_000, currency: 'KZT' as const },
    };
  }

  function createRequests() {
    return ctx.http.requests.filter((r) => r.url.endsWith('/api/1/deliveries/create'));
  }

  function tokenRequests() {
    return ctx.http.requests.filter((r) => r.url.endsWith('/api/1/access_token'));
  }

  it('manual provider (default): export is skipped, no external calls and no alerts', async () => {
    const branchId = await createBranch(t);
    const order = kitchenOrder(branchId, { items: [item(newId(), 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);

    const exp = await exportOf(order.orderId);
    expect(exp.status).toBe('skipped');
    expect(exp.skip_reason).toBe('manual_provider');
    expect(exp.provider).toBe('manual');
    expect(exp.attempts).toBe(0);
    expect(ctx.http.requests).toHaveLength(0);
    expect(ctx.fakes.notifier.staff).toHaveLength(0);
    expect(await outbox(PosEvents.OrderSentToPos)).toHaveLength(0);
  });

  it('iiko: caches the access token (~50 min), maps the order to deliveries/create, publishes OrderSentToPos', async () => {
    const branchId = await createBranch(t);
    const { apiLogin } = await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    const lagman = newId();
    const cheese = newId();
    await mapDish(branchId, plov, 'P-PLOV', { [cheese]: { externalProductId: 'M-CHEESE', externalGroupId: 'G-ADD' } });
    await mapDish(branchId, lagman, 'P-LAGMAN');
    ctx.http
      .on('/api/1/access_token', 200, { correlationId: 'c1', token: 'tok-1' }, { times: 1 })
      .on('/api/1/access_token', 200, { correlationId: 'c2', token: 'tok-2' })
      .on('/api/1/deliveries/create', 200, { correlationId: 'c3', orderInfo: { id: 'IIKO-1', creationStatus: 'InProgress' } })
      .on('/api/1/deliveries/by_id', 200, { orders: [{ id: 'IIKO-1', creationStatus: 'Success' }] });

    const first = kitchenOrder(branchId, {
      items: [item(plov, 'Плов', 2, [{ optionId: cheese, name: 'Сыр' }]), item(lagman, 'Лагман')],
      scheduledFor: '2026-10-01T13:00:00.000Z',
      comment: 'Позвонить за 10 минут',
    });
    ctx.fakes.orders.orders.set(first.orderId, first);
    await publishAccepted(t, first);

    expect(tokenRequests()).toHaveLength(1);
    expect(JSON.parse(tokenRequests()[0]!.body!)).toEqual({ apiLogin });
    expect(tokenRequests()[0]!.url).toBe('https://iiko.test/api/1/access_token');
    expect(createRequests()).toHaveLength(1);
    const create = createRequests()[0]!;
    expect(create.headers.authorization).toBe('Bearer tok-1');
    const body = JSON.parse(create.body!);
    expect(body.organizationId).toBe(ORG_ID);
    expect(body.terminalGroupId).toBe(TERMINAL_GROUP_ID);
    expect(body.order.id).toBe(first.orderId);
    expect(body.order.externalNumber).toBe(first.number);
    expect(body.order.phone).toBe('+77011234567');
    expect(body.order.customer).toEqual({ name: 'Айгерим' });
    expect(body.order.orderServiceType).toBe('DeliveryByCourier');
    expect(body.order.deliveryPoint).toEqual({ comment: 'Астана, ул. Сарайшык, 5' });
    expect(body.order.completeBefore).toMatch(/^2026-10-01 \d{2}:00:00\.000$/);
    expect(body.order.comment).toContain('Позвонить за 10 минут');
    expect(body.order.comment).toContain('Оплачен онлайн');
    expect(body.order.items).toEqual([
      { productId: 'P-PLOV', amount: 2, type: 'Product', modifiers: [{ productId: 'M-CHEESE', amount: 1, productGroupId: 'G-ADD' }] },
      { productId: 'P-LAGMAN', amount: 1, type: 'Product', modifiers: [] },
    ]);

    const exp = await exportOf(first.orderId);
    expect(exp.status).toBe('sent');
    expect(exp.pos_order_id).toBe('IIKO-1');
    expect(exp.provider).toBe('iiko');
    expect(exp.attempts).toBe(1);
    // iiko создаёт заказ асинхронно (InProgress) — подтверждение проверяется отдельной задачей.
    expect(exp.confirmed_at).toBeNull();
    const sent = await outbox(PosEvents.OrderSentToPos);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ orderId: first.orderId, branchId, posOrderId: 'IIKO-1', provider: 'iiko' });

    // Второй заказ (самовывоз) — тем же токеном, без запроса нового.
    const second = kitchenOrder(branchId, { type: 'pickup', deliveryAddress: null, items: [item(lagman, 'Лагман', 3)] });
    ctx.fakes.orders.orders.set(second.orderId, second);
    await publishAccepted(t, second);
    expect(tokenRequests()).toHaveLength(1);
    expect(createRequests()).toHaveLength(2);
    const pickup = JSON.parse(createRequests()[1]!.body!);
    expect(pickup.order.orderServiceType).toBe('DeliveryByClient');
    expect(pickup.order).not.toHaveProperty('deliveryPoint');

    // Через 51 минуту токен запрашивается заново.
    t.clock.advance(51 * 60_000);
    const third = kitchenOrder(branchId, { items: [item(lagman, 'Лагман')] });
    ctx.fakes.orders.orders.set(third.orderId, third);
    await publishAccepted(t, third);
    expect(tokenRequests()).toHaveLength(2);
    expect(createRequests()[2]!.headers.authorization).toBe('Bearer tok-2');
    // Проверка создания первого заказа прошла (deliveries/by_id -> Success).
    const byId = ctx.http.requests.filter((r) => r.url.endsWith('/api/1/deliveries/by_id'));
    expect(JSON.parse(byId[0]!.body!)).toEqual({ organizationId: ORG_ID, orderIds: ['IIKO-1'] });
    expect((await exportOf(first.orderId)).confirmed_at).not.toBeNull();

    // Журнал интеграций: полный обмен, но API-логин и токен замаскированы.
    const logs = await sql<{ request: any; response: any }>`
      select request, response from platform.integration_logs where integration = 'pos.iiko' and operation = 'access_token'`.execute(db());
    expect(logs.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs.rows)).not.toContain(apiLogin);
    expect(logs.rows[0]!.request.body.apiLogin).toMatch(/^\*\*\*/);
    expect(logs.rows[0]!.response.body.token).toMatch(/^\*\*\*/);
  });

  it('iiko 5xx: the job is retried with backoff and succeeds; no alert', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http
      .on('/api/1/access_token', 200, { token: 'tok' })
      .on('/api/1/deliveries/create', 503, { errorDescription: 'Service temporarily unavailable' }, { times: 1 })
      .on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-9', creationStatus: 'Success' } });
    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);
    let exp = await exportOf(order.orderId);
    expect(exp.status).toBe('pending');
    expect(exp.attempts).toBe(1);
    expect(exp.last_error).toContain('503');
    expect(exp.last_error).toContain('Service temporarily unavailable');

    // Повтор — не раньше задержки.
    await t.drain();
    expect(createRequests()).toHaveLength(1);
    t.clock.advance(31_000);
    await t.drain();

    exp = await exportOf(order.orderId);
    expect(exp.status).toBe('sent');
    expect(exp.pos_order_id).toBe('IIKO-9');
    expect(exp.attempts).toBe(2);
    expect(exp.last_error).toBeNull();
    expect(createRequests()).toHaveLength(2);
    expect(JSON.parse(createRequests()[1]!.body!).order.id).toBe(order.orderId);
    expect(ctx.fakes.notifier.staff).toHaveLength(0);
    expect(await failedJobs()).toBe(0);
  });

  it('asynchronous creation: POS rejects the order later -> failed, OrderPosFailed, alert; silence -> staff asked to check the till', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http
      .on('/api/1/access_token', 200, { token: 'tok' })
      .on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-A', creationStatus: 'InProgress' } }, { times: 1 })
      .on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-B', creationStatus: 'InProgress' } }, { times: 1 })
      .on(/by_id/, 200, { orders: [{ id: 'IIKO-A', creationStatus: 'InProgress' }] }, { times: 1 })
      .on(/by_id/, 200, { orders: [{ id: 'IIKO-A', creationStatus: 'Error', errorInfo: { code: 'TerminalOffline', description: 'Terminal is offline' } }] }, { times: 1 })
      .on(/by_id/, 200, { orders: [{ id: 'IIKO-B', creationStatus: 'InProgress' }] });

    const rejected = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(rejected.orderId, rejected);
    await publishAccepted(t, rejected);
    expect((await exportOf(rejected.orderId)).status).toBe('sent');

    t.clock.advance(31_000);
    await t.drain(); // InProgress — ждём
    expect((await exportOf(rejected.orderId)).status).toBe('sent');
    t.clock.advance(31_000);
    await t.drain(); // Error — отклонён
    const exp = await exportOf(rejected.orderId);
    expect(exp).toMatchObject({ status: 'failed', failure_reason: 'rejected', last_error: 'Terminal is offline', confirm_checks: 2, pos_order_id: 'IIKO-A' });
    expect((await outbox(PosEvents.OrderPosFailed))[0]).toMatchObject({ orderId: rejected.orderId, reason: 'rejected', error: 'Terminal is offline' });
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect((ctx.fakes.notifier.staff[0]!.params as { details: string }).details).toContain('Terminal is offline');

    // Второй заказ POS так и не подтвердила — после 6 проверок персонал просят проверить кассу.
    const silent = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(silent.orderId, silent);
    await publishAccepted(t, silent);
    for (let i = 0; i < 10; i++) {
      t.clock.advance(5 * 60_000);
      await t.drain();
    }
    const unconfirmed = await exportOf(silent.orderId);
    expect(unconfirmed).toMatchObject({ status: 'sent', confirmed_at: null, confirm_checks: 6 });
    expect(ctx.fakes.notifier.staff).toHaveLength(2);
    expect((ctx.fakes.notifier.staff[1]!.params as { title: string }).title).toBe(`Заказ ${silent.number} не подтверждён POS`);
    expect(await failedJobs()).toBe(0);

    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const list = await t.http().get(`/api/v1/admin/pos/exports?orderId=${silent.orderId}`).set('authorization', admin.auth);
    expect(list.body.items[0]).toMatchObject({ status: 'sent', confirmedAt: null, canRetry: false });
  });

  it('iiko 401: the token is refreshed once and the request repeated', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http
      .on('/api/1/access_token', 200, { token: 'old' }, { times: 1 })
      .on('/api/1/access_token', 200, { token: 'new' })
      .on('/api/1/deliveries/create', 401, { errorDescription: 'Token expired' }, { times: 1 })
      .on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-R', creationStatus: 'Success' } });
    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);

    expect(createRequests().map((r) => r.headers.authorization)).toEqual(['Bearer old', 'Bearer new']);
    expect(await exportOf(order.orderId)).toMatchObject({ status: 'sent', attempts: 1, pos_order_id: 'IIKO-R' });
    expect((await exportOf(order.orderId)).confirmed_at).not.toBeNull();
  });

  it('iiko 400: non-retryable failure, OrderPosFailed, staff alert and admin feed item; the order is not retried', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-GONE');
    ctx.http
      .on('/api/1/access_token', 200, { token: 'tok' })
      .on('/api/1/deliveries/create', 400, { errorDescription: 'Product P-GONE not found' });
    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);

    const exp = await exportOf(order.orderId);
    expect(exp.status).toBe('failed');
    expect(exp.failure_reason).toBe('rejected');
    expect(exp.last_error).toContain('Product P-GONE not found');
    const failed = await outbox(PosEvents.OrderPosFailed);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ orderId: order.orderId, number: order.number, branchId, provider: 'iiko', reason: 'rejected', attempts: 1 });

    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect(ctx.fakes.notifier.staff[0]).toMatchObject({
      template: 'staff.system_alert',
      audience: { branchId, permission: 'orders.manage', includeBranchChannels: true },
    });
    expect((ctx.fakes.notifier.staff[0]!.params as { title: string }).title).toBe(`Заказ ${order.number} не передан в POS`);
    expect(ctx.fakes.adminFeed.events).toEqual([
      { branchId, stream: 'orders', kind: 'updated', entityId: order.orderId, title: `Заказ ${order.number} не передан в POS`, sound: true },
    ]);

    t.clock.advance(60 * 60_000);
    await t.drain();
    expect(createRequests()).toHaveLength(1);
    expect(await failedJobs()).toBe(0);
  });

  it('missing mapping: failure recorded with details, staff alerted, no external calls; after mapping — manual retry sends', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const lagman = newId();
    const manty = newId();
    const sauce = newId();
    await mapDish(branchId, lagman, 'P-LAGMAN');
    const order = kitchenOrder(branchId, {
      items: [item(lagman, 'Лагман', 1, [{ optionId: sauce, name: 'Соус острый' }]), item(manty, 'Манты', 2)],
    });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);

    const exp = await exportOf(order.orderId);
    expect(exp.status).toBe('failed');
    expect(exp.failure_reason).toBe('missing_mapping');
    expect(exp.details.missing).toEqual([
      { dishId: lagman, dishName: 'Лагман', dishMissing: false, options: [{ optionId: sauce, name: 'Соус острый' }] },
      { dishId: manty, dishName: 'Манты', dishMissing: true, options: [] },
    ]);
    expect(ctx.http.requests).toHaveLength(0);
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect((ctx.fakes.notifier.staff[0]!.params as { details: string }).details).toContain('Манты');
    expect((await outbox(PosEvents.OrderPosFailed))[0]).toMatchObject({ reason: 'missing_mapping' });

    // Оператор филиала видит проблему в списке передач.
    const operator = await tokenFor(t, [{ role: 'branch_operator', branchId }]);
    const list = await t.http().get(`/api/v1/admin/pos/exports?branchId=${branchId}&status=failed`).set('authorization', operator.auth);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ orderId: order.orderId, status: 'failed', failureReason: 'missing_mapping', canRetry: true });
    expect(list.body.items[0].missingMappings).toHaveLength(2);

    // Администратор интеграций сопоставляет блюдо и опцию.
    const admin = await tokenFor(t, [{ role: 'sysadmin' }]);
    ctx.fakes.menu.add({ dishId: manty, name: 'Манты', price: 300_000 });
    ctx.fakes.menu.add({ dishId: lagman, name: 'Лагман', price: 250_000 });
    const created = await t
      .http()
      .post('/api/v1/admin/pos/mappings')
      .set('authorization', admin.auth)
      .send({ branchId, dishId: manty, externalProductId: 'P-MANTY' });
    expect(created.status).toBe(201);
    const existing = await t.http().get(`/api/v1/admin/pos/mappings?branchId=${branchId}&dishId=${lagman}`).set('authorization', admin.auth);
    const updated = await t
      .http()
      .put(`/api/v1/admin/pos/mappings/${existing.body.items[0].id}`)
      .set('authorization', admin.auth)
      .send({ externalProductId: 'P-LAGMAN', modifiers: [{ optionId: sauce, externalProductId: 'M-SAUCE', externalGroupId: 'G-SAUCE' }] });
    expect(updated.status).toBe(200);

    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-77' } });
    const retried = await t.http().post(`/api/v1/admin/pos/exports/${exp.id}/retry`).set('authorization', operator.auth);
    expect(retried.status).toBe(200);
    expect(retried.body).toMatchObject({ status: 'pending', attempts: 0, manualRetries: 1, canRetry: false, missingMappings: [] });
    await t.drain();

    const after = await exportOf(order.orderId);
    expect(after.status).toBe('sent');
    expect(after.pos_order_id).toBe('IIKO-77');
    const body = JSON.parse(createRequests()[0]!.body!);
    expect(body.order.items).toEqual([
      { productId: 'P-LAGMAN', amount: 1, type: 'Product', modifiers: [{ productId: 'M-SAUCE', amount: 1, productGroupId: 'G-SAUCE' }] },
      { productId: 'P-MANTY', amount: 2, type: 'Product', modifiers: [] },
    ]);
    const audit = await sql<{ action: string }>`select action from platform.audit_log where entity_id = ${exp.id} order by occurred_at, id`.execute(db());
    expect(audit.rows.map((r) => r.action)).toEqual(['pos.order_export_failed', 'pos.order_export_retried', 'pos.order_export_sent']);

    // Повтор уже переданного — недопустимый переход.
    const again = await t.http().post(`/api/v1/admin/pos/exports/${exp.id}/retry`).set('authorization', operator.auth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('pos.order_export.invalid_transition');
  });

  it('POS down: after the attempt limit the export fails (retries_exhausted) with event and alert, not in the platform failed queue', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/deliveries/create', 502, 'Bad gateway');
    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);
    for (let i = 0; i < 10; i++) {
      t.clock.advance(20 * 60_000);
      await t.drain();
    }

    const exp = await exportOf(order.orderId);
    expect(exp.status).toBe('failed');
    expect(exp.failure_reason).toBe('retries_exhausted');
    expect(exp.attempts).toBe(6);
    expect(createRequests()).toHaveLength(6);
    expect((await outbox(PosEvents.OrderPosFailed))[0]).toMatchObject({ reason: 'retries_exhausted', attempts: 6 });
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect((ctx.fakes.notifier.staff[0]!.params as { details: string }).details).toContain('готовьте по экрану заказа');
    expect(await failedJobs()).toBe(0);
  });

  it('not configured: branch routed to a POS without organization settings fails as not_configured', async () => {
    const branchId = await createBranch(t);
    const other = await createBranch(t);
    await routeToIiko(t, { [other]: {} });
    await t.get(IntegrationSettings).set('pos.routing', { enabled: true, config: { default: 'manual', branches: { [branchId]: 'iiko', [other]: 'iiko' } } }, null);
    const order = kitchenOrder(branchId, { items: [item(newId(), 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);
    await mapDish(branchId, order.items[0]!.dishId, 'P-PLOV');

    await publishAccepted(t, order);

    const exp = await exportOf(order.orderId);
    expect(exp.status).toBe('failed');
    expect(exp.failure_reason).toBe('not_configured');
    expect(ctx.http.requests).toHaveLength(0);
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
  });

  it('order cancelled before the push is skipped; a cancelled order already in POS alerts staff', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-5' } });

    // «Отклонить» = paid -> accepted -> cancelled в одной транзакции: в POS не передаём.
    const rejected = kitchenOrder(branchId, { status: 'cancelled', items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(rejected.orderId, rejected);
    await publishAccepted(t, rejected);
    expect((await exportOf(rejected.orderId)).status).toBe('skipped');
    expect((await exportOf(rejected.orderId)).skip_reason).toBe('order_cancelled');
    expect(createRequests()).toHaveLength(0);

    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);
    await publishAccepted(t, order);
    expect((await exportOf(order.orderId)).status).toBe('sent');

    const cancelled: OrderCancelledPayload = {
      orderId: order.orderId,
      number: order.number,
      branchId,
      type: order.type,
      channel: 'web',
      customer: { customerId: null, phone: order.customer.phone, name: order.customer.name },
      total: order.total,
      reasonCode: 'guest_request',
      reason: null,
      wasPaid: true,
      cancelledAt: t.clock.now().toISOString(),
    };
    await t.database.transaction(() => t.get(EventBus).publish(OrderingEvents.OrderCancelled, cancelled, { aggregateId: order.orderId, branchId }));
    await t.drain();
    expect(ctx.fakes.notifier.staff).toHaveLength(1);
    expect((ctx.fakes.notifier.staff[0]!.params as { title: string }).title).toContain('отменён');
    expect((ctx.fakes.notifier.staff[0]!.params as { details: string }).details).toContain('IIKO-5');
  });

  it('a repeated accepted event does not create a second export or a second POS order', async () => {
    const branchId = await createBranch(t);
    await routeToIiko(t, { [branchId]: {} });
    const plov = newId();
    await mapDish(branchId, plov, 'P-PLOV');
    ctx.http.on('/api/1/access_token', 200, { token: 'tok' }).on('/api/1/deliveries/create', 200, { orderInfo: { id: 'IIKO-1' } });
    const order = kitchenOrder(branchId, { items: [item(plov, 'Плов')] });
    ctx.fakes.orders.orders.set(order.orderId, order);

    await publishAccepted(t, order);
    await publishAccepted(t, order);

    const rows = await sql<{ n: string }>`select count(*) as n from pos.order_exports where order_id = ${order.orderId}`.execute(db());
    expect(Number(rows.rows[0]!.n)).toBe(1);
    expect(createRequests()).toHaveLength(1);
  });

  it('exports list and retry: 401 without token, 403 without permission, branch scoping', async () => {
    const branchA = await createBranch(t);
    const branchB = await createBranch(t);
    for (const branchId of [branchA, branchB]) {
      const order = kitchenOrder(branchId, { items: [item(newId(), 'Плов')] });
      ctx.fakes.orders.orders.set(order.orderId, order);
      await publishAccepted(t, order);
    }

    expect((await t.http().get('/api/v1/admin/pos/exports')).status).toBe(401);
    const content = await tokenFor(t, [{ role: 'content_manager' }]);
    const denied = await t.http().get('/api/v1/admin/pos/exports').set('authorization', content.auth);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('access.forbidden');

    const operatorA = await tokenFor(t, [{ role: 'branch_operator', branchId: branchA }]);
    const own = await t.http().get('/api/v1/admin/pos/exports').set('authorization', operatorA.auth);
    expect(own.status).toBe(200);
    expect(own.body.items.map((i: { branchId: string }) => i.branchId)).toEqual([branchA]);
    const foreign = await t.http().get(`/api/v1/admin/pos/exports?branchId=${branchB}`).set('authorization', operatorA.auth);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('access.forbidden_branch');

    const sysadmin = await tokenFor(t, [{ role: 'sysadmin' }]);
    const all = await t.http().get('/api/v1/admin/pos/exports?perPage=10').set('authorization', sysadmin.auth);
    expect(all.body.total).toBe(2);
    expect(all.body.perPage).toBe(10);
    const exportB = all.body.items.find((i: { branchId: string }) => i.branchId === branchB);
    expect(exportB).toMatchObject({ status: 'skipped', skipReason: 'manual_provider', canRetry: true });

    const retryForeign = await t.http().post(`/api/v1/admin/pos/exports/${exportB.id}/retry`).set('authorization', operatorA.auth);
    expect(retryForeign.status).toBe(403);
    const missing = await t.http().post(`/api/v1/admin/pos/exports/${newId()}/retry`).set('authorization', sysadmin.auth);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('pos_order_export.not_found');

    const badQuery = await t.http().get('/api/v1/admin/pos/exports?status=unknown').set('authorization', sysadmin.auth);
    expect(badQuery.status).toBe(400);
  });
});
