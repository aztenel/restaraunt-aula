import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../../shared/infrastructure/events/event-bus';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { CustomersEvents } from '../customers/public';
import { OrderingEvents } from './public';
import {
  addDish,
  addZone,
  checkoutBody,
  createOrderingTestApp,
  OrderingTestContext,
  paymentSucceeded,
  PHONE,
  publishedEvents,
  setupBranch,
  staff,
} from './testing/ordering-test-kit';

describe('Ordering: admin orders and permissions (integration)', () => {
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

  async function place(branchId: string, overrides: Record<string, unknown> = {}) {
    const dish = addDish(ctx, `Плов ${Math.random()}`, 4_000);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', ...overrides }))
      .expect(201);
    return res.body as { orderId: string; number: string; publicToken: string; payment: { id: string } };
  }

  it('admin endpoints require a staff token and the right permissions', async () => {
    const order = await place(branchA);
    await api().get('/api/v1/admin/orders').expect(401);
    await api().get(`/api/v1/admin/orders/${order.orderId}`).expect(401);
    await api().post(`/api/v1/admin/orders/${order.orderId}/transition`).send({ to: 'accepted' }).expect(401);
    const content = await staff(ctx, 'content_manager');
    await api().get('/api/v1/admin/orders').set('Authorization', content).expect(403);
    await api().get('/api/v1/admin/orders/queue').set('Authorization', content).expect(403);
    const finance = await staff(ctx, 'finance');
    // Финансы видят заказы, но не меняют статусы.
    await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', finance).expect(200);
    await api().post(`/api/v1/admin/orders/${order.orderId}/transition`).set('Authorization', finance).send({ to: 'accepted' }).expect(403);
  });

  it('operator of branch A cannot see or touch orders of branch B', async () => {
    const a = await place(branchA);
    const b = await place(branchB);
    await paymentSucceeded(ctx, b.payment.id);
    const operatorA = await staff(ctx, 'branch_operator', branchA);

    const list = await api().get('/api/v1/admin/orders').set('Authorization', operatorA).expect(200);
    expect(list.body.items.map((o: { id: string }) => o.id)).toEqual([a.orderId]);
    const foreign = await api().get(`/api/v1/admin/orders?branchId=${branchB}`).set('Authorization', operatorA).expect(403);
    expect(foreign.body.error.code).toBe('access.forbidden_branch');
    await api().get(`/api/v1/admin/orders/${b.orderId}`).set('Authorization', operatorA).expect(403);
    await api().post(`/api/v1/admin/orders/${b.orderId}/transition`).set('Authorization', operatorA).send({ to: 'accepted' }).expect(403);
    await api().post(`/api/v1/admin/orders/${b.orderId}/reject`).set('Authorization', operatorA).send({ reasonCode: 'other' }).expect(403);
    await api().post(`/api/v1/admin/orders/${b.orderId}/cancel`).set('Authorization', operatorA).send({ reasonCode: 'other' }).expect(403);
    await api().get(`/api/v1/admin/orders/queue?branchId=${branchB}`).set('Authorization', operatorA).expect(403);
    const queue = await api().get('/api/v1/admin/orders/queue').set('Authorization', operatorA).expect(200);
    const ids = queue.body.groups.flatMap((g: { orders: Array<{ id: string }> }) => g.orders.map((o) => o.id));
    expect(ids).toEqual([a.orderId]);
    const dish = addDish(ctx, 'Самса', 1_000);
    await api()
      .post('/api/v1/admin/orders')
      .set('Authorization', operatorA)
      .send(checkoutBody(branchB, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', paymentMethod: 'on_receipt', analyticsSessionId: undefined }))
      .expect(403);

    const owner = await staff(ctx, 'owner');
    const all = await api().get('/api/v1/admin/orders').set('Authorization', owner).expect(200);
    expect(all.body.total).toBe(2);
  });

  it('list filters: status (repeated or comma), type, number/phone search, date range', async () => {
    const owner = await staff(ctx, 'owner');
    const first = await place(branchA);
    await paymentSucceeded(ctx, first.payment.id);
    const dish = addDish(ctx, 'Самса', 5_000);
    await addZone(ctx, branchA);
    ctx.t.clock.set(zonedTimeToUtc('2026-10-02', '12:00', 'Asia/Almaty'));
    const second = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchA, [{ dishId: dish.dishId, quantity: 1 }], { customer: { name: 'Ержан', phone: '87779998877' } }))
      .expect(201);

    const get = async (query: string) =>
      (await api().get(`/api/v1/admin/orders?${query}`).set('Authorization', owner).expect(200)).body.items.map((o: { id: string }) => o.id);
    expect(await get('status=paid')).toEqual([first.orderId]);
    expect(await get('status=paid&status=awaiting_payment')).toEqual([second.body.orderId, first.orderId]);
    expect(await get('status=paid,awaiting_payment')).toHaveLength(2);
    expect(await get('type=delivery')).toEqual([second.body.orderId]);
    expect(await get(`q=${second.body.number}`)).toEqual([second.body.orderId]);
    expect(await get('q=7779998877')).toEqual([second.body.orderId]);
    expect(await get('dateFrom=2026-10-01&dateTo=2026-10-01')).toEqual([first.orderId]);
    expect(await get('dateFrom=2026-10-02')).toEqual([second.body.orderId]);
    await api().get('/api/v1/admin/orders?status=unknown').set('Authorization', owner).expect(400);
    const page = await api().get('/api/v1/admin/orders?perPage=1&page=2').set('Authorization', owner).expect(200);
    expect(page.body).toMatchObject({ total: 2, page: 2, perPage: 1 });
    expect(page.body.items[0]).toMatchObject({ id: first.orderId, customer: { phone: PHONE }, total: { amount: 400_000 } });
  });

  it('operator queue groups active orders by status with items, transitions and lateness', async () => {
    const waiting = await place(branchA);
    const paid = await place(branchA);
    await paymentSucceeded(ctx, paid.payment.id);
    const operator = await staff(ctx, 'branch_operator', branchA);
    let queue = await api().get(`/api/v1/admin/orders/queue?branchId=${branchA}`).set('Authorization', operator).expect(200);
    const group = (status: string) => queue.body.groups.find((g: { status: string }) => g.status === status);
    expect(queue.body.groups.map((g: { status: string }) => g.status)).toEqual([
      'awaiting_payment',
      'paid',
      'accepted',
      'cooking',
      'ready',
      'delivering',
    ]);
    expect(group('awaiting_payment').orders[0]).toMatchObject({
      id: waiting.orderId,
      allowedTransitions: ['cancelled'],
      canCancel: true,
      canReject: false,
      courier: null,
      amountDue: { amount: 0, currency: 'KZT' },
    });
    expect(group('paid')).toMatchObject({
      count: 1,
      orders: [{ id: paid.orderId, allowedTransitions: ['accepted'], isLate: false, canCancel: false, canReject: true, amountDue: { amount: 0 } }],
    });
    expect(group('paid').orders[0].items[0]).toMatchObject({ quantity: 1, name: { ru: expect.stringContaining('Плов') } });
    ctx.t.clock.advance(2 * 60 * 60_000);
    queue = await api().get('/api/v1/admin/orders/queue').set('Authorization', operator).expect(200);
    expect(group('paid').orders[0].isLate).toBe(true);

    // Оплата при получении: сколько получить с гостя; финансы видят очередь без действий.
    const onReceipt = await place(branchA, { paymentMethod: 'on_receipt', phoneVerificationToken: `verified:${PHONE}` });
    queue = await api().get('/api/v1/admin/orders/queue').set('Authorization', operator).expect(200);
    const card = group('paid').orders.find((o: { id: string }) => o.id === onReceipt.orderId);
    expect(card).toMatchObject({ paymentMethod: 'on_receipt', amountDue: { amount: 400_000, currency: 'KZT' }, canReject: true });
    const finance = await staff(ctx, 'finance');
    queue = await api().get(`/api/v1/admin/orders/queue?branchId=${branchA}`).set('Authorization', finance).expect(200);
    expect(group('paid').orders[0]).toMatchObject({ allowedTransitions: [], canCancel: false, canReject: false });
  });

  it('quote shows the dish name and photo for stopped or foreign-branch lines', async () => {
    const operator = await staff(ctx, 'branch_operator', branchA);
    const plov = addDish(ctx, 'Плов', 3_000);
    const stopped = addDish(ctx, 'Манты', 2_500, { availability: 'stopped_hidden' });
    const foreign = addDish(ctx, 'Бешбармак', 5_000, { branchIds: [branchB] });
    const quote = await api()
      .post('/api/v1/public/orders/quote')
      .send({
        branchId: branchA,
        type: 'pickup',
        items: [
          { dishId: plov.dishId, quantity: 1 },
          { dishId: stopped.dishId, quantity: 1 },
          { dishId: foreign.dishId, quantity: 1 },
          { dishId: '01a0d872-0000-7000-8000-000000000000', quantity: 1 },
        ],
      })
      .expect(200);
    expect(quote.body.lines).toMatchObject([
      { index: 0, name: 'Плов', available: true, problem: null },
      { index: 1, name: 'Манты', photoUrl: null, available: false, problem: 'catalog.dish_unavailable', unitPrice: null },
      { index: 2, name: 'Бешбармак', available: false, problem: 'catalog.dish_not_in_branch_menu' },
      { index: 3, name: null, available: false, problem: 'catalog.dish_not_in_branch_menu' },
    ]);
    expect(quote.body.total).toEqual({ amount: 300_000, currency: 'KZT' });
    const admin = await api()
      .post('/api/v1/admin/orders/quote')
      .set('Authorization', operator)
      .send({ branchId: branchA, type: 'pickup', items: [{ dishId: stopped.dishId, quantity: 1 }] })
      .expect(200);
    expect(admin.body.lines[0]).toMatchObject({ name: 'Манты', problem: 'catalog.dish_unavailable' });
  });

  it('branch menu for phone orders: dishes with modifiers, stopped ones flagged; orders.manage in the branch', async () => {
    const plov = addDish(ctx, 'Плов', 3_000, { modifiers: [{ groupId: 'g-1', optionId: 'o-1', name: 'Сыр', price: 30_000 }] });
    addDish(ctx, 'Манты', 2_500, { availability: 'stopped_shown' });
    addDish(ctx, 'Бешбармак', 5_000, { branchIds: [branchB] });
    const operator = await staff(ctx, 'branch_operator', branchA);
    const menu = await api().get(`/api/v1/admin/orders/menu?branchId=${branchA}`).set('Authorization', operator).expect(200);
    expect(menu.body.branchId).toBe(branchA);
    expect(menu.body.dishes.map((d: { name: { ru: string } }) => d.name.ru)).toEqual(['Плов', 'Манты']);
    expect(menu.body.dishes[0]).toMatchObject({
      dishId: plov.dishId,
      price: { amount: 300_000, currency: 'KZT' },
      stopped: false,
      availability: 'available',
      modifierGroups: [{ id: 'g-1', options: [{ id: 'o-1', name: { ru: 'Сыр' }, price: { amount: 30_000 } }] }],
    });
    expect(menu.body.dishes[1]).toMatchObject({ stopped: true, availability: 'stopped_shown' });
    expect(menu.body.categories).toEqual([expect.objectContaining({ id: 'cat-1' })]);

    await api().get(`/api/v1/admin/orders/menu?branchId=${branchB}`).set('Authorization', operator).expect(403);
    await api().get('/api/v1/admin/orders/menu').set('Authorization', operator).expect(400);
    const finance = await staff(ctx, 'finance');
    await api().get(`/api/v1/admin/orders/menu?branchId=${branchA}`).set('Authorization', finance).expect(403);
    await api().get(`/api/v1/admin/orders/menu?branchId=${branchA}`).expect(401);
  });

  it('phone order by an operator: channel admin, on_receipt without SMS code, online sends the guest a status link', async () => {
    const operator = await staff(ctx, 'branch_operator', branchA);
    const dish = addDish(ctx, 'Плов', 3_000);
    const quote = await api()
      .post('/api/v1/admin/orders/quote')
      .set('Authorization', operator)
      .send({ branchId: branchA, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 2 }] })
      .expect(200);
    expect(quote.body.total).toEqual({ amount: 600_000, currency: 'KZT' });
    await api()
      .post('/api/v1/admin/orders/quote')
      .set('Authorization', operator)
      .send({ branchId: branchB, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 2 }] })
      .expect(403);

    const body = checkoutBody(branchA, [{ dishId: dish.dishId, quantity: 2 }], { type: 'pickup', paymentMethod: 'on_receipt' });
    delete (body as Record<string, unknown>).analyticsSessionId;
    const res = await api().post('/api/v1/admin/orders').set('Authorization', operator).send(body).expect(201);
    expect(res.body).toMatchObject({ status: 'paid', channel: 'admin', paymentMethod: 'on_receipt', total: { amount: 600_000 } });
    expect(res.body.createdBy).toEqual(expect.any(String));
    expect(res.body.createdByName).toBe('Сотрудник');
    expect(res.body.payments[0]).toMatchObject({ kind: 'on_receipt', status: 'pending' });
    expect(ctx.fakes.customers.consents[0]).toMatchObject({ kind: 'personal_data', granted: true });
    expect((ctx.fakes.customers.consents[0] as unknown as { source: string }).source).toBe('phone');
    const placed = await publishedEvents(ctx.t, OrderingEvents.OrderPlaced);
    expect(placed[0]!.payload.channel).toBe('admin');
    // Витринные поля (SMS-токен, сессия аналитики) оператору недоступны.
    await api()
      .post('/api/v1/admin/orders')
      .set('Authorization', operator)
      .send({ ...body, idempotencyKey: 'another-key-123', phoneVerificationToken: 'x' })
      .expect(400);

    const online = await api()
      .post('/api/v1/admin/orders')
      .set('Authorization', operator)
      .send({ ...body, paymentMethod: 'online', idempotencyKey: 'phone-order-online-1' })
      .expect(201);
    expect(online.body).toMatchObject({ status: 'awaiting_payment', channel: 'admin' });
    const created = ctx.fakes.notifier.guest.filter((g) => g.template === 'order.created');
    expect(created).toHaveLength(2);
    expect((created[1]!.params as { trackingUrl: string }).trackingUrl).toBe(online.body.trackingUrl);
    expect(online.body.trackingUrl).toContain(`/ru/orders/${online.body.publicToken}`);
  });

  it('order details describe items, totals, payments, history and allowed actions computed by the server', async () => {
    const order = await place(branchA);
    const manager = await staff(ctx, 'branch_manager', branchA);
    let details = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', manager).expect(200);
    expect(details.body).toMatchObject({
      status: 'awaiting_payment',
      allowedTransitions: ['cancelled'],
      canCancel: true,
      canReject: false,
      canRefund: false,
      refundable: { amount: 0 },
      payments: [{ kind: 'online', attempt: 1, method: 'online', status: 'created' }],
      courierDispatch: null,
      comment: 'Без лука',
      locale: 'ru',
    });
    await paymentSucceeded(ctx, order.payment.id);
    details = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', manager).expect(200);
    expect(details.body).toMatchObject({ status: 'paid', allowedTransitions: ['accepted'], canReject: true, canCancel: false });
    await api().post(`/api/v1/admin/orders/${order.orderId}/transition`).set('Authorization', manager).send({ to: 'accepted' }).expect(200);
    details = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', manager).expect(200);
    expect(details.body).toMatchObject({ allowedTransitions: ['cooking', 'cancelled'], canRefund: true, refundable: { amount: 400_000 } });
    const operator = await staff(ctx, 'branch_operator', branchA);
    const asOperator = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', operator).expect(200);
    expect(asOperator.body.canRefund).toBe(false);
    await api().get('/api/v1/admin/orders/not-a-uuid').set('Authorization', operator).expect(400);
  });

  it('guest anonymization erases contacts and address in orders', async () => {
    const dish = addDish(ctx, 'Плов', 5_000);
    await addZone(ctx, branchA);
    const res = await api().post('/api/v1/public/orders').send(checkoutBody(branchA, [{ dishId: dish.dishId, quantity: 1 }])).expect(201);
    const customerId = [...ctx.fakes.customers.customers.values()][0]!.id;
    await ctx.t.get(EventBus).publish(CustomersEvents.CustomerAnonymized, { customerId, occurredAt: new Date().toISOString() });
    await ctx.t.drain();
    const owner = await staff(ctx, 'owner');
    const details = await api().get(`/api/v1/admin/orders/${res.body.orderId}`).set('Authorization', owner).expect(200);
    expect(details.body.customer).toEqual({ customerId, name: null, phone: 'anonymized', email: null });
    expect(details.body.delivery).toMatchObject({ addressText: 'anonymized', apartment: null, intercom: null });
    expect(details.body.total).toEqual({ amount: 550_000, currency: 'KZT' });
  });
});
