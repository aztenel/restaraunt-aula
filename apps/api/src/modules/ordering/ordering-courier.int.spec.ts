import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationSettings } from '../../shared/infrastructure/settings/integration-settings';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { COURIER_ROUTING_SETTINGS_KEY } from './application/courier-dispatch.registry';
import { CourierJobs } from './application/courier-requests';
import { YANDEX_DELIVERY_SETTINGS_KEY } from './infrastructure/adapters/yandex/yandex-delivery.settings';
import {
  addDish,
  addZone,
  checkoutBody,
  createOrderingTestApp,
  enqueuedJobs,
  OrderingTestContext,
  paymentSucceeded,
  setupBranch,
  staff,
} from './testing/ordering-test-kit';

describe('Ordering: courier dispatch via the delivery service (integration)', () => {
  let ctx: OrderingTestContext;
  let branchId: string;
  let operator: string;

  beforeAll(async () => {
    ctx = await createOrderingTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await ctx.reset();
    branchId = await setupBranch(ctx);
    await addZone(ctx, branchId);
    operator = await staff(ctx, 'branch_operator', branchId);
  });

  const api = () => ctx.t.http();
  const seconds = (n: number) => n * 1_000;

  async function routeToService(withCredentials = true) {
    const settings = ctx.t.get(IntegrationSettings);
    await settings.set(COURIER_ROUTING_SETTINGS_KEY, { enabled: true, config: { default: 'own', branches: { [branchId]: 'yandex' } } }, null);
    if (withCredentials) {
      await settings.set(YANDEX_DELIVERY_SETTINGS_KEY, { enabled: true, config: { emergencyContactName: 'AULA' }, secrets: { token: 'y-token-1234' } }, null);
    }
  }

  async function readyDeliveryOrder(paymentMethod: 'online' | 'on_receipt' = 'online') {
    const dish = addDish(ctx, 'Плов', 5_000);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(
        checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], {
          paymentMethod,
          phoneVerificationToken: 'verified:+77011234567',
        }),
      )
      .expect(201);
    if (paymentMethod === 'online') await paymentSucceeded(ctx, res.body.payment.id);
    for (const to of ['accepted', 'cooking', 'ready']) {
      await api().post(`/api/v1/admin/orders/${res.body.orderId}/transition`).set('Authorization', operator).send({ to }).expect(200);
    }
    return res.body as { orderId: string; publicToken: string };
  }

  const details = async (orderId: string) => (await api().get(`/api/v1/admin/orders/${orderId}`).set('Authorization', operator).expect(200)).body;

  it('own couriers by default: no claim, the operator moves the order', async () => {
    const order = await readyDeliveryOrder();
    await ctx.t.drain();
    expect(await enqueuedJobs(ctx.t, CourierJobs.Create)).toEqual([]);
    expect((await details(order.orderId)).courierDispatch).toBeNull();
    expect(ctx.http.requests).toEqual([]);
    const catalog = ctx.t.get(IntegrationCatalog);
    expect(catalog.get(COURIER_ROUTING_SETTINGS_KEY)?.fields[0]?.options).toEqual(['own', 'yandex']);
    expect(catalog.get(YANDEX_DELIVERY_SETTINGS_KEY)?.category).toBe('delivery');
  });

  it('ready delivery order creates a claim; polling confirms it, tracks the courier and moves the order to completed', async () => {
    await routeToService();
    ctx.http.on('/claims/create', 200, { id: 'claim-1', status: 'new', version: 1 }, { times: 1 });
    const order = await readyDeliveryOrder('on_receipt');
    let d = (await details(order.orderId)).courierDispatch;
    expect(d).toMatchObject({ status: 'requested', externalId: null });
    await ctx.t.drain();

    const create = ctx.http.requests[0]!;
    expect(create.url).toBe(`https://b2b.taxi.yandex.net/b2b/cargo/integration/v2/claims/create?request_id=${d.id}`);
    expect(create.headers.authorization).toBe('Bearer y-token-1234');
    const body = JSON.parse(create.body!);
    expect(body.route_points[1]).toMatchObject({ type: 'destination', contact: { phone: '+77011234567' }, address: { sflat: '25', door_code: '25К' } });
    expect(body.comment).toContain('Оплата при получении');
    d = (await details(order.orderId)).courierDispatch;
    expect(d).toMatchObject({ status: 'estimating', externalId: 'claim-1', providerStatus: 'new', attempts: 1 });

    // Оценка готова — заявка подтверждается.
    ctx.http
      .on('/claims/info', 200, { id: 'claim-1', status: 'ready_for_approval', version: 2 }, { times: 2 })
      .on('/claims/accept', 200, { id: 'claim-1', status: 'accepted', version: 3 }, { times: 1 });
    ctx.t.clock.advance(seconds(30));
    await ctx.t.drain();
    expect(JSON.parse(ctx.http.requests.find((r) => r.url.includes('/claims/accept'))!.body!)).toEqual({ version: 2 });
    expect((await details(order.orderId)).courierDispatch).toMatchObject({ status: 'searching', providerStatus: 'accepted' });

    // Курьер найден: имя, телефон (переадресация), ссылка отслеживания, стоимость.
    ctx.http
      .on('/claims/info', 200, { id: 'claim-1', status: 'performer_found', version: 4, pricing: { final_price: '850.00' }, performer_info: { courier_name: 'Ерлан' } }, { times: 1 })
      .on('/tracking-links', 200, { route_points: [{ type: 'destination', sharing_link: 'https://track.example/claim-1' }] }, { times: 1 })
      .on('/driver-voiceforwarding', 200, { phone: '+77001112233', ext: '123' }, { times: 1 });
    ctx.t.clock.advance(seconds(30));
    await ctx.t.drain();
    expect((await details(order.orderId)).courierDispatch).toMatchObject({
      status: 'courier_assigned',
      courierName: 'Ерлан',
      courierPhone: '+77001112233 доб. 123',
      trackingUrl: 'https://track.example/claim-1',
      price: { amount: 85_000 },
    });
    const tracking = await api().get(`/api/v1/public/orders/${order.publicToken}`).expect(200);
    expect(tracking.body.courier).toEqual({ status: 'courier_assigned', trackingUrl: 'https://track.example/claim-1', courierName: 'Ерлан' });

    // Курьер забрал — заказ «в пути» (от имени системы), гостю уведомление.
    ctx.http.on('/claims/info', 200, { id: 'claim-1', status: 'pickuped', version: 5, performer_info: { courier_name: 'Ерлан' } }, { times: 1 });
    ctx.t.clock.advance(seconds(30));
    await ctx.t.drain();
    let view = await details(order.orderId);
    expect(view.status).toBe('delivering');
    expect(view.history.at(-1)).toMatchObject({ to: 'delivering', actorKind: 'system' });
    expect(ctx.fakes.notifier.guest.map((g) => g.template)).toContain('order.delivering');
    // Известные ссылка и телефон повторно не запрашиваются.
    expect(ctx.http.requests.filter((r) => r.url.includes('/tracking-links'))).toHaveLength(1);

    ctx.http.on('/claims/info', 200, { id: 'claim-1', status: 'delivered_finish', version: 6 }, { times: 1 });
    ctx.t.clock.advance(seconds(30));
    await ctx.t.drain();
    view = await details(order.orderId);
    expect(view.status).toBe('completed');
    expect(view.courierDispatch).toMatchObject({ status: 'delivered', finishedAt: expect.any(String) });
    expect(ctx.fakes.payments.collected).toHaveLength(1);
    // Опрос завершён.
    const before = ctx.http.requests.length;
    ctx.t.clock.advance(seconds(60));
    await ctx.t.drain();
    expect(ctx.http.requests.length).toBe(before);
  });

  it('retries a failing create with backoff; a rejected claim fails the dispatch and alerts the branch', async () => {
    await routeToService();
    ctx.http.on('/claims/create', 503, { code: 'unavailable', message: 'try later' }, { times: 1 });
    ctx.http.on('/claims/create', 200, { id: 'claim-2', status: 'new', version: 1 }, { times: 1 });
    const order = await readyDeliveryOrder();
    await ctx.t.drain();
    expect((await details(order.orderId)).courierDispatch).toMatchObject({ status: 'requested', lastError: expect.stringContaining('try later') });
    ctx.t.clock.advance(seconds(15));
    await ctx.t.drain();
    expect((await details(order.orderId)).courierDispatch).toMatchObject({ status: 'estimating', externalId: 'claim-2', attempts: 2, lastError: null });

    // Неповторяемая ошибка (400) — заявка не удалась, в ленту админки — оповещение со звуком.
    const other = await readyDeliveryOrder();
    ctx.http.on('/claims/create', 400, { code: 'validation_error', message: 'bad phone' }, { times: 1 });
    await ctx.t.drain();
    expect((await details(other.orderId)).courierDispatch).toMatchObject({ status: 'failed', lastError: expect.stringContaining('bad phone') });
    expect(ctx.fakes.adminFeed.events.at(-1)).toMatchObject({ entityId: other.orderId, sound: true });

    // Оператор вызывает курьера повторно.
    ctx.http.on('/claims/create', 200, { id: 'claim-3', status: 'new', version: 1 }, { times: 1 });
    const retried = await api().post(`/api/v1/admin/orders/${other.orderId}/courier/retry`).set('Authorization', operator).expect(200);
    expect(retried.body.courierDispatch).toMatchObject({ status: 'requested' });
    await api().post(`/api/v1/admin/orders/${other.orderId}/courier/retry`).set('Authorization', operator).expect(409);
    await ctx.t.drain();
    expect((await details(other.orderId)).courierDispatch).toMatchObject({ status: 'estimating', externalId: 'claim-3' });
  });

  it('operator cancels an active claim; the service cancel uses the claim version and cancel state', async () => {
    await routeToService();
    ctx.http.on('/claims/create', 200, { id: 'claim-9', status: 'new', version: 1 }, { times: 1 });
    const order = await readyDeliveryOrder();
    await ctx.t.drain();
    ctx.http
      .on('/claims/info', 200, { id: 'claim-9', status: 'performer_lookup', version: 4 }, { times: 1 })
      .on('/claims/cancel-info', 200, { cancel_state: 'free' }, { times: 1 })
      .on('/claims/cancel?', 200, { id: 'claim-9', status: 'cancelled', version: 5 }, { times: 1 });
    await api().post(`/api/v1/admin/orders/${order.orderId}/courier/cancel`).set('Authorization', operator).expect(200);
    await ctx.t.drain();
    const cancel = ctx.http.requests.find((r) => r.url.includes('/claims/cancel?'))!;
    expect(JSON.parse(cancel.body!)).toEqual({ version: 4, cancel_state: 'free' });
    expect((await details(order.orderId)).courierDispatch).toMatchObject({ status: 'cancelled' });
    await api().post(`/api/v1/admin/orders/${order.orderId}/courier/cancel`).set('Authorization', operator).expect(409);
    // Статус заказа ведёт оператор (свой курьер).
    await api().post(`/api/v1/admin/orders/${order.orderId}/transition`).set('Authorization', operator).send({ to: 'delivering' }).expect(200);
  });

  it('routing to the service without its settings fails the dispatch without blocking the order', async () => {
    await routeToService(false);
    const order = await readyDeliveryOrder();
    expect((await details(order.orderId)).status).toBe('ready');
    await ctx.t.drain();
    expect((await details(order.orderId)).courierDispatch).toMatchObject({ status: 'failed', lastError: expect.stringContaining('not configured') });
    expect(ctx.http.requests).toEqual([]);
  });
});
