import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  createE2eApp,
  deliveries,
  E2E_TODAY,
  E2eContext,
  feed,
  money,
  outboxEvents,
  pendingOutbox,
  POINT_NEAR_GL,
  sandboxPay,
} from './support/e2e-app';
import {
  adminOrder,
  advanceOrder,
  customerByPhone,
  GUEST_PHONE,
  modifierOption,
  paymentsOf,
  placeOrder,
  report,
  storefrontMenu,
  tracking,
} from './support/ordering';

/**
 * Сценарий 1: онлайн-заказ доставки от витрины до отчётов — Catalog (цена филиала) → Ordering (зона, расчёт,
 * оформление) → Payments (инициирование задачей, песочница, вебхук) → Ordering (paid) → Notifications (гость,
 * персонал, лента) → переходы оператора → POS (manual → skipped) → Reporting → Customers.
 */
describe('E2E 1: online delivery order end-to-end', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('menu → resolve → quote → checkout → sandbox payment → paid → lifecycle → POS → reports → customer history', async () => {
    const { greenline, gardenView } = ctx.seed.branches;

    // ---------------------------------------------------------------- Витрина: меню с ценой филиала
    const glMenu = await storefrontMenu(ctx, 'greenline');
    const gvMenu = await storefrontMenu(ctx, 'garden-view');
    const kazy = glMenu.get('kazy')!;
    const manty = glMenu.get('manty')!;
    expect(kazy).toMatchObject({ name: 'Казы', price: money(4_900), available: true });
    expect(gvMenu.get('kazy')!.price).toEqual(money(5_200)); // одно блюдо — разная цена в филиалах
    expect(manty.price).toEqual(money(3_600));
    const garlic = await modifierOption(ctx, 'greenline', 'manty', 'Чесночный');
    expect(garlic.price.amount).toBe(30_000);
    // Стоп-лист из сида: шубат в Garden View недоступен, в GreenLine доступен.
    expect(gvMenu.get('shubat')?.available ?? false).toBe(false);
    expect(glMenu.get('shubat')!.available).toBe(true);

    // ---------------------------------------------------------------- Выбор филиала по точке доставки
    const resolved = await ctx.api().post('/api/v1/public/delivery/resolve').query({ locale: 'ru' }).send({ point: POINT_NEAR_GL, address: 'ул. Е-899, 5' }).expect(200);
    expect(resolved.body).toMatchObject({
      deliverable: true,
      address: 'ул. Е-899, 5',
      best: { branch: { id: greenline, slug: 'greenline' }, zone: { name: 'Ближняя зона', deliveryFee: money(500), minOrderAmount: money(3_000) } },
    });
    // Точку покрывает и дальняя зона Garden View (дороже) — альтернатива, а не выбор.
    expect(resolved.body.alternatives).toEqual(
      expect.arrayContaining([expect.objectContaining({ branch: expect.objectContaining({ id: gardenView }), zone: expect.objectContaining({ deliveryFee: money(1_000) }) })]),
    );

    // ---------------------------------------------------------------- Расчёт корзины (сервером)
    const items = [
      { dishId: manty.id, quantity: 1, modifierOptionIds: [garlic.id] },
      { dishId: kazy.id, quantity: 1 },
    ];
    const quote = await ctx
      .api()
      .post('/api/v1/public/orders/quote')
      .query({ locale: 'ru' })
      .send({ branchId: greenline, type: 'delivery', items, point: POINT_NEAR_GL, phone: GUEST_PHONE })
      .expect(200);
    // (3 600 + 300) + 4 900 = 8 800 ₸ + доставка 500 ₸
    expect(quote.body).toMatchObject({
      subtotal: money(8_800),
      discount: money(0),
      deliveryFee: money(500),
      total: money(9_300),
      amountDue: money(9_300),
      canCheckout: true,
      problems: [],
      delivery: { deliverable: true, zoneName: 'Ближняя зона', minOrderReached: true, amountToFreeDelivery: money(1_200) },
    });
    expect(quote.body.lines[0]).toMatchObject({ name: 'Манты, 5 шт.', unitPrice: money(3_900), lineTotal: money(3_900), available: true });

    // ---------------------------------------------------------------- Оформление: онлайн-оплата
    const placed = await placeOrder(ctx, { branchId: greenline, type: 'delivery', items, paymentMethod: 'online', email: 'aigerim@example.kz' });
    expect(placed.body).toMatchObject({ status: 'awaiting_payment', total: money(9_300), replayed: false, payment: { method: 'online', status: 'created', paymentUrl: null } });
    expect(placed.number).toMatch(/^GL-2026-\d{6}$/);
    const orderId = placed.orderId;

    // Страница оплаты создаётся задачей в очереди: до обработки ссылки нет.
    let track = await tracking(ctx, placed.publicToken);
    expect(track).toMatchObject({ status: 'awaiting_payment', payment: { method: 'online', isPaid: false, amountDue: money(9_300), current: { status: 'created', paymentUrl: null } } });
    await ctx.drain();
    track = await tracking(ctx, placed.publicToken);
    expect(track.payment.current).toMatchObject({ status: 'pending', paymentUrl: expect.stringContaining('/public/payments/sandbox/') });
    expect(track.items.map((i: any) => i.name)).toEqual(['Манты, 5 шт.', 'Казы']);
    expect(track.delivery).toMatchObject({ addressText: 'Астана, ул. Е-899, 5, кв. 12', point: POINT_NEAR_GL });

    // Пока не оплачен — персоналу не сообщаем, в ленте без звука.
    expect(await deliveries(ctx, { relatedId: orderId, template: 'staff.order_new' })).toEqual([]);
    expect((await feed(ctx)).filter((f) => f.entityId === orderId && f.sound)).toEqual([]);

    // Операторы филиалов (у оператора GreenLine в профиле телефон — WhatsApp для уведомлений персоналу).
    const glOperator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL', { phone: '+77010000555' });
    const gvOperator = await ctx.staff([{ role: 'branch_operator', branchId: gardenView }], 'Оператор GV', { phone: '+77010000666' });

    // ---------------------------------------------------------------- Оплата в песочнице → вебхук → paid
    await sandboxPay(ctx, track.payment.current.paymentUrl);
    await ctx.drain();
    track = await tracking(ctx, placed.publicToken);
    expect(track).toMatchObject({ status: 'paid', payment: { isPaid: true, current: { status: 'succeeded' } } });
    const [payment] = await paymentsOf(ctx, orderId);
    expect(payment).toMatchObject({ purpose: 'order', method: 'online', provider: 'sandbox', status: 'succeeded', amount: money(9_300), branchId: greenline });

    // Контракт события PaymentSucceeded, на котором Ordering перевёл заказ в paid.
    const succeeded = (await outboxEvents(ctx, 'payments.payment_succeeded')).filter((e) => e.payload.referenceId === orderId);
    expect(succeeded).toHaveLength(1);
    expect(succeeded[0]!.payload).toMatchObject({ purpose: 'order', method: 'online', provider: 'sandbox', amount: money(9_300) });
    // Обычная оплата (не «поздняя» после отмены) — без previousStatus.
    expect(succeeded[0]!.payload.previousStatus).toBeUndefined();

    // Уведомления: гостю (создан, оплачен) и персоналу филиала (новый заказ) — доставлены (вне продакшена — в журнал).
    const guestMsgs = await deliveries(ctx, { relatedId: orderId, audience: 'guest' });
    expect(guestMsgs.map((d) => d.template).sort()).toEqual(['order.created', 'order.paid']);
    expect(guestMsgs.every((d) => d.status === 'sent' && d.recipient.startsWith('+7 701'))).toBe(true);
    // Персоналу — сотрудникам с правом orders.manage в ЭТОМ филиале (оператор другого филиала не получает).
    const staffMsgs = await deliveries(ctx, { relatedId: orderId, template: 'staff.order_new' });
    expect(staffMsgs).toEqual([
      expect.objectContaining({ audience: 'staff', branchId: greenline, channel: 'whatsapp', recipientName: 'Оператор GL', status: 'sent' }),
    ]);
    // Лента админки: новый заказ со звуком в очереди заказов филиала.
    const newOrderFeed = (await feed(ctx)).filter((f) => f.entityId === orderId && f.kind === 'created');
    expect(newOrderFeed).toEqual([expect.objectContaining({ stream: 'orders', branchId: greenline, sound: true, title: expect.stringContaining(placed.number) })]);

    // ---------------------------------------------------------------- Оператор филиала ведёт заказ
    // Оператор другого филиала: ни увидеть, ни изменить.
    await ctx.api().get(`/api/v1/admin/orders/${orderId}`).set('Authorization', gvOperator.auth).expect(403);
    await ctx.api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', gvOperator.auth).send({ to: 'accepted' }).expect(403);
    const queueGv = await ctx.api().get('/api/v1/admin/orders/queue').set('Authorization', gvOperator.auth).expect(200);
    expect(JSON.stringify(queueGv.body)).not.toContain(orderId);
    const queueGl = await ctx.api().get('/api/v1/admin/orders/queue').set('Authorization', glOperator.auth).expect(200);
    expect(JSON.stringify(queueGl.body)).toContain(orderId);

    let details = await adminOrder(ctx, orderId, glOperator.auth);
    expect(details).toMatchObject({ status: 'paid', allowedTransitions: ['accepted'], canReject: true, wasPaid: true, amountDue: money(9_300) });
    // Переход не по схеме — 409.
    const invalid = await ctx.api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', glOperator.auth).send({ to: 'ready' }).expect(409);
    expect(invalid.body.error.code).toBeTruthy();

    await advanceOrder(ctx, orderId, glOperator.auth, 'accepted');
    await ctx.drain();
    // POS: филиал в режиме manual — передача зафиксирована и пропущена (кухня работает по экрану админки).
    const exportsRes = await ctx.api().get('/api/v1/admin/pos/exports').query({ orderId }).set('Authorization', glOperator.auth).expect(200);
    expect(exportsRes.body.items).toEqual([expect.objectContaining({ orderId, orderNumber: placed.number, provider: 'manual', status: 'skipped', branchId: greenline })]);

    await advanceOrder(ctx, orderId, glOperator.auth, 'cooking');
    await advanceOrder(ctx, orderId, glOperator.auth, 'ready');
    details = await adminOrder(ctx, orderId, glOperator.auth);
    // Заказ доставки обязательно проходит «в пути» (ready → completed только для самовывоза).
    expect(details.allowedTransitions).toEqual(['delivering']);
    await ctx.api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', glOperator.auth).send({ to: 'completed' }).expect(409);
    await advanceOrder(ctx, orderId, glOperator.auth, 'delivering');
    await advanceOrder(ctx, orderId, glOperator.auth, 'completed');
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);

    details = await adminOrder(ctx, orderId, glOperator.auth);
    expect(details).toMatchObject({ status: 'completed', allowedTransitions: [], canCancel: false, canReject: false });
    expect(details.history.map((h: any) => h.to)).toEqual(['awaiting_payment', 'paid', 'accepted', 'cooking', 'ready', 'delivering', 'completed']);
    track = await tracking(ctx, placed.publicToken);
    expect(track.timeline.map((h: any) => h.status)).toEqual(['awaiting_payment', 'paid', 'accepted', 'cooking', 'ready', 'delivering', 'completed']);
    const lifecycleMsgs = (await deliveries(ctx, { relatedId: orderId, audience: 'guest' })).map((d) => d.template).sort();
    expect(lifecycleMsgs).toEqual(['order.accepted', 'order.completed', 'order.created', 'order.delivering', 'order.paid']);

    // Журнал действий: каждый переход — с сотрудником, прежним и новым статусом.
    const audit = await auditLog(ctx, { entityId: orderId, action: 'order.status_changed' });
    expect(audit.map((a) => `${a.before.status}>${a.after.status}`)).toEqual([
      'draft>awaiting_payment',
      'awaiting_payment>paid',
      'paid>accepted',
      'accepted>cooking',
      'cooking>ready',
      'ready>delivering',
      'delivering>completed',
    ]);
    expect(audit.slice(2).every((a) => a.actorUserId === glOperator.userId)).toBe(true);
    expect((await auditLog(ctx, { entityType: 'payment', action: 'payment.' })).map((a) => a.action)).toEqual(
      expect.arrayContaining(['payment.initiated']),
    );

    // ---------------------------------------------------------------- Отчёты
    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.days).toEqual([expect.objectContaining({ date: E2E_TODAY, delivery: money(9_300), pickup: money(0), total: money(9_300) })]);
    expect(revenue.totals).toMatchObject({ delivery: money(9_300), total: money(9_300), refunds: money(0) });
    expect(revenue.counts).toMatchObject({ delivery: 1, pickup: 0 });
    const gvRevenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: gardenView });
    expect(gvRevenue.totals.total).toEqual(money(0));

    const top = await report(ctx, 'top-dishes', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(top.items.map((i: any) => [i.dishId, i.quantity, i.revenue.amount])).toEqual([
      [kazy.id, 1, 490_000],
      [manty.id, 1, 390_000],
    ]);
    expect(top.totalRevenue).toEqual(money(8_800));

    const avg = await report(ctx, 'average-check', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(avg.orders).toMatchObject({ count: 1, revenue: money(9_300), average: money(9_300) });
    expect(avg.channels.find((c: any) => c.channel === 'delivery')).toMatchObject({ count: 1, average: money(9_300) });

    const cash = await report(ctx, 'payments', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cash.totals).toMatchObject({ received: money(9_300), refunded: money(0), moneyReceived: money(9_300) });

    // ---------------------------------------------------------------- База гостей: история и счётчики
    const guest = await customerByPhone(ctx, GUEST_PHONE);
    expect(guest.customer).toMatchObject({
      phone: GUEST_PHONE,
      name: 'Айгерим',
      email: 'aigerim@example.kz',
      ordersCount: 1,
      completedOrdersCount: 1,
      totalSpent: money(9_300),
      personalDataConsent: true,
      marketingConsent: true,
    });
    expect(guest.consents.map((c: any) => [c.kind, c.granted, c.source])).toEqual(
      expect.arrayContaining([
        ['personal_data', true, 'web'],
        ['marketing', true, 'web'],
      ]),
    );
    expect(guest.activities.items.map((a: any) => a.type).sort()).toEqual(['order_completed', 'order_placed']);
    expect(guest.activities.items.find((a: any) => a.type === 'order_completed')).toMatchObject({ entityId: orderId, amount: money(9_300), countsAsSpent: true });
    expect(guest.totals).toMatchObject({ spent: money(9_300), ordersPlaced: 1, ordersCompleted: 1 });
  });
});
