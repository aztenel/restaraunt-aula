import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createBranch } from '../../../test/support/fixtures';
import { newId } from '../../shared/kernel/ids';
import { Money } from '../../shared/kernel/money';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { OrderingEvents, OrderQuery } from './public';
import {
  addDish,
  addPromo,
  addZone,
  auditActions,
  checkoutBody,
  createOrderingTestApp,
  OrderingTestContext,
  paymentsOf,
  paymentSucceeded,
  PHONE,
  publishedEvents,
  setupBranch,
  staff,
} from './testing/ordering-test-kit';

describe('Ordering: checkout (integration)', () => {
  let ctx: OrderingTestContext;
  let branchId: string;

  beforeAll(async () => {
    ctx = await createOrderingTestApp();
  });
  afterAll(async () => ctx.t.close());
  beforeEach(async () => {
    await ctx.reset();
    branchId = await setupBranch(ctx);
  });

  const api = () => ctx.t.http();

  function transition(orderId: string, to: string, auth: string) {
    return api().post(`/api/v1/admin/orders/${orderId}/transition`).set('Authorization', auth).send({ to });
  }

  it('full online flow: quote -> checkout -> payment succeeded -> paid -> accepted -> cooking -> ready -> delivering -> completed', async () => {
    const plov = addDish(ctx, 'Плов', 3_500, {
      modifiers: [{ groupId: 'g1', optionId: 'opt-cheese', name: 'Сыр', price: 30_000 }],
    });
    const salad = addDish(ctx, 'Салат', 1_500);
    await addZone(ctx, branchId);
    const items = [
      { dishId: plov.dishId, quantity: 2, modifierOptionIds: ['opt-cheese'] },
      { dishId: salad.dishId, quantity: 1 },
    ];

    const quote = await api()
      .post('/api/v1/public/orders/quote?locale=ru')
      .send({ branchId, type: 'delivery', items, point: { lat: 51.1, lng: 71.42 } })
      .expect(200);
    // (3500 + 300) * 2 + 1500 = 9100 ₸, доставка 500 ₸
    expect(quote.body.subtotal).toEqual({ amount: 910_000, currency: 'KZT' });
    expect(quote.body.deliveryFee).toEqual({ amount: 50_000, currency: 'KZT' });
    expect(quote.body.total).toEqual({ amount: 960_000, currency: 'KZT' });
    expect(quote.body.lines[0]).toMatchObject({ name: 'Плов', quantity: 2, unitPrice: { amount: 380_000 }, available: true, problem: null });
    expect(quote.body.lines[0].modifiers[0]).toMatchObject({ optionId: 'opt-cheese', name: 'Сыр', price: { amount: 30_000 } });
    expect(quote.body.delivery).toMatchObject({ deliverable: true, minOrderReached: true, amountToFreeDelivery: { amount: 1_090_000 } });
    expect(quote.body.canCheckout).toBe(true);

    const res = await api().post('/api/v1/public/orders').send(checkoutBody(branchId, items)).expect(201);
    expect(res.body).toMatchObject({ status: 'awaiting_payment', total: { amount: 960_000 }, replayed: false });
    expect(res.body.number).toMatch(/^B\d{4}-2026-000001$/);
    expect(res.body.payment).toMatchObject({ method: 'online', status: 'created', amount: { amount: 960_000 } });
    const orderId: string = res.body.orderId;

    const placed = await publishedEvents(ctx.t, OrderingEvents.OrderPlaced);
    expect(placed).toHaveLength(1);
    expect(placed[0]!.payload).toMatchObject({
      orderId,
      status: 'awaiting_payment',
      channel: 'web',
      paymentMethod: 'online',
      customer: { phone: PHONE, name: 'Айгерим' },
      total: { amount: 960_000, currency: 'KZT' },
      analyticsSessionId: 'sess-1',
    });
    expect(ctx.fakes.notifier.guest.map((g) => [g.template, g.dedupeKey])).toEqual([['order.created', `order:${orderId}:created`]]);
    expect(ctx.fakes.customers.consents.map((c) => [c.kind, c.granted])).toEqual([
      ['personal_data', true],
      ['marketing', true],
    ]);
    // Пока не оплачен — персоналу не сообщаем, в очереди без звука.
    expect(ctx.fakes.notifier.staff).toHaveLength(0);
    expect(ctx.fakes.adminFeed.events.some((e) => e.sound)).toBe(false);

    // Витрина опрашивает статус и получает ссылку на оплату.
    const tracking = await api().get(`/api/v1/public/orders/${res.body.publicToken}?locale=ru`).expect(200);
    expect(tracking.body).toMatchObject({
      status: 'awaiting_payment',
      payment: { method: 'online', isPaid: false, amountDue: { amount: 960_000 }, current: { paymentUrl: expect.stringContaining('https://pay.test/') } },
      paymentMethod: 'online',
      isPaidOnline: false,
    });
    expect(tracking.body.items[0]).toMatchObject({ name: 'Плов', quantity: 2 });

    await paymentSucceeded(ctx, res.body.payment.id);
    const paid = await api().get(`/api/v1/public/orders/${res.body.publicToken}`).expect(200);
    expect(paid.body).toMatchObject({ status: 'paid', paymentMethod: 'online', isPaidOnline: true, payment: { isPaid: true, isPaidOnline: true } });
    expect(ctx.fakes.notifier.staff.map((s) => s.template)).toEqual(['staff.order_new']);
    expect(ctx.fakes.adminFeed.events.find((e) => e.kind === 'created')).toMatchObject({ entityId: orderId, stream: 'orders', sound: true });
    expect(ctx.fakes.notifier.guest.map((g) => g.template)).toContain('order.paid');

    const operator = await staff(ctx, 'branch_operator', branchId);
    for (const to of ['accepted', 'cooking', 'ready', 'delivering', 'completed']) {
      const r = await transition(orderId, to, operator).expect(200);
      expect(r.body.status).toBe(to);
    }
    const guestTemplates = ctx.fakes.notifier.guest.map((g) => g.dedupeKey);
    expect(guestTemplates).toEqual(
      expect.arrayContaining([`order:${orderId}:accepted`, `order:${orderId}:delivering`, `order:${orderId}:completed`]),
    );
    const statuses = (await publishedEvents(ctx.t, OrderingEvents.OrderStatusChanged)).map((e) => `${e.payload.from}>${e.payload.to}`);
    expect(statuses).toEqual([
      'awaiting_payment>paid',
      'paid>accepted',
      'accepted>cooking',
      'cooking>ready',
      'ready>delivering',
      'delivering>completed',
    ]);
    const completed = await publishedEvents(ctx.t, OrderingEvents.OrderCompleted);
    expect(completed[0]!.payload).toMatchObject({ orderId, total: { amount: 960_000 }, items: expect.any(Array) });
    expect((await auditActions(ctx.t, orderId)).filter((a) => a === 'order.status_changed')).toHaveLength(7);

    const details = await api().get(`/api/v1/admin/orders/${orderId}`).set('Authorization', operator).expect(200);
    expect(details.body).toMatchObject({ status: 'completed', allowedTransitions: [], canCancel: false, wasPaid: true });
    expect(details.body.history.map((h: { to: string }) => h.to)).toEqual([
      'awaiting_payment',
      'paid',
      'accepted',
      'cooking',
      'ready',
      'delivering',
      'completed',
    ]);
    // Онлайн-оплата не «получается при выдаче».
    expect(ctx.fakes.payments.collected).toEqual([]);
  });

  it('on_receipt: phone verification required by the branch, order is paid immediately, money collected on completion', async () => {
    const dish = addDish(ctx, 'Лагман', 4_000);
    await addZone(ctx, branchId);
    const items = [{ dishId: dish.dishId, quantity: 1 }];
    const body = checkoutBody(branchId, items, { paymentMethod: 'on_receipt' });
    const denied = await api().post('/api/v1/public/orders').send(body).expect(422);
    expect(denied.body.error.code).toBe('phone.not_verified');
    await api()
      .post('/api/v1/public/orders')
      .send({ ...body, phoneVerificationToken: 'verified:+77000000000' })
      .expect(422);

    const res = await api()
      .post('/api/v1/public/orders')
      .send({ ...body, phoneVerificationToken: `verified:${PHONE}` })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'paid', payment: { method: 'on_receipt', status: 'pending', paymentUrl: null } });
    const orderId = res.body.orderId;
    expect(ctx.fakes.notifier.staff.map((s) => s.template)).toEqual(['staff.order_new']);
    expect(ctx.fakes.adminFeed.events.find((e) => e.kind === 'created')?.sound).toBe(true);
    const placed = await publishedEvents(ctx.t, OrderingEvents.OrderPlaced);
    expect(placed[0]!.payload).toMatchObject({ status: 'awaiting_payment', paymentMethod: 'on_receipt' });
    // Оплата при получении: «оплата обеспечена» (isPaid), но витрина не показывает «Оплачено».
    const tracking = await api().get(`/api/v1/public/orders/${res.body.publicToken}`).expect(200);
    expect(tracking.body).toMatchObject({
      status: 'paid',
      paymentMethod: 'on_receipt',
      isPaidOnline: false,
      payment: { method: 'on_receipt', isPaid: true, isPaidOnline: false },
    });

    const kitchen = await ctx.t.get(OrderQuery).getKitchenOrder(orderId);
    expect(kitchen).toMatchObject({
      orderId,
      status: 'paid',
      paymentMethod: 'on_receipt',
      isPaidOnline: false,
      total: { amount: 450_000 },
      deliveryAddress: 'Астана, ул. Сыганак, 10, кв./офис 25, домофон 25К',
      comment: 'Без лука',
    });
    expect(kitchen.items[0]).toMatchObject({ dishId: dish.dishId, quantity: 1, unitPrice: { amount: 400_000 } });

    const operator = await staff(ctx, 'branch_operator', branchId);
    for (const to of ['accepted', 'cooking', 'ready', 'delivering']) await transition(orderId, to, operator).expect(200);
    expect(ctx.fakes.payments.collected).toEqual([]);
    await transition(orderId, 'completed', operator).expect(200);
    expect(ctx.fakes.payments.collected).toEqual([res.body.payment.id]);
  });

  it('on_receipt without verification when the branch does not require it', async () => {
    const branch = await setupBranch(ctx, { requirePhoneVerificationForOnReceipt: false });
    const dish = addDish(ctx, 'Манты', 3_000);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branch, [{ dishId: dish.dishId, quantity: 2 }], { type: 'pickup', paymentMethod: 'on_receipt' }))
      .expect(201);
    expect(res.body.status).toBe('paid');
  });

  it('pickup flow: ready -> completed, guest gets "ready" with the branch address, delivering is forbidden', async () => {
    const dish = addDish(ctx, 'Бешбармак', 6_000);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', contactless: true }))
      .expect(201);
    expect(res.body.total).toEqual({ amount: 600_000, currency: 'KZT' });
    await paymentSucceeded(ctx, res.body.payment.id);
    const operator = await staff(ctx, 'branch_operator', branchId);
    for (const to of ['accepted', 'cooking', 'ready']) await transition(res.body.orderId, to, operator).expect(200);
    const ready = ctx.fakes.notifier.guest.find((g) => g.template === 'order.ready');
    expect(ready).toMatchObject({ dedupeKey: `order:${res.body.orderId}:ready` });
    expect((ready!.params as { branchAddress: string }).branchAddress).toContain('Кабанбай');
    const bad = await transition(res.body.orderId, 'delivering', operator).expect(409);
    expect(bad.body.error.code).toBe('order.invalid_transition');
    await transition(res.body.orderId, 'completed', operator).expect(200);
    const tracking = await api().get(`/api/v1/public/orders/${res.body.publicToken}`).expect(200);
    expect(tracking.body).toMatchObject({ status: 'completed', delivery: null, deliveryFee: { amount: 0 } });
    expect(tracking.body.timeline.map((e: { status: string }) => e.status)).toEqual([
      'awaiting_payment',
      'paid',
      'accepted',
      'cooking',
      'ready',
      'completed',
    ]);
  });

  it('idempotent checkout: the same key returns the same order, another branch with the key is a conflict', async () => {
    const dish = addDish(ctx, 'Плов', 3_000);
    const body = checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' });
    const first = await api().post('/api/v1/public/orders').send(body).expect(201);
    const second = await api().post('/api/v1/public/orders').send(body).expect(201);
    expect(second.body).toMatchObject({ orderId: first.body.orderId, number: first.body.number, replayed: true });
    expect(second.body.payment.id).toBe(first.body.payment.id);
    expect(await publishedEvents(ctx.t, OrderingEvents.OrderPlaced)).toHaveLength(1);
    expect(paymentsOf(ctx, first.body.orderId)).toHaveLength(1);
    const other = await setupBranch(ctx);
    const conflict = await api()
      .post('/api/v1/public/orders')
      .send({ ...body, branchId: other })
      .expect(409);
    expect(conflict.body.error.code).toBe('order.idempotency_key_reused');
  });

  it('totals are never taken from the client', async () => {
    const dish = addDish(ctx, 'Плов', 3_000);
    const body = checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' });
    const withTotal = await api()
      .post('/api/v1/public/orders')
      .send({ ...body, total: { amount: 1, currency: 'KZT' } })
      .expect(400);
    expect(withTotal.body.error.code).toBe('request.invalid');
    await api()
      .post('/api/v1/public/orders')
      .send({ ...body, items: [{ dishId: dish.dishId, quantity: 1, price: 1 }] })
      .expect(400);
    await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 1 }], discount: 100 })
      .expect(400);
    const res = await api().post('/api/v1/public/orders').send(body).expect(201);
    expect(res.body.total).toEqual({ amount: 300_000, currency: 'KZT' });
    expect(res.body.payment.amount).toEqual({ amount: 300_000, currency: 'KZT' });
  });

  it('validates the address zone, minimal order, consent, branch settings and dish availability', async () => {
    const dish = addDish(ctx, 'Плов', 1_000);
    const stopped = addDish(ctx, 'Шашлык', 2_500, { availability: 'stopped_shown' });
    await addZone(ctx, branchId, { minOrderAmount: Money.tenge(3_000) });
    const post = (overrides: Record<string, unknown>, items = [{ dishId: dish.dishId, quantity: 5 }]) =>
      api().post('/api/v1/public/orders').send(checkoutBody(branchId, items, overrides));

    const far = await post({ delivery: { point: { lat: 43.2, lng: 76.9 }, addressText: 'Алматы' } }).expect(422);
    expect(far.body.error.code).toBe('order.address_not_deliverable');
    const noAddress = await post({ delivery: null }).expect(422);
    expect(noAddress.body.error.code).toBe('order.address_required');
    const small = await post({}, [{ dishId: dish.dishId, quantity: 1 }]).expect(422);
    expect(small.body.error.code).toBe('order.min_order_not_reached');
    const noConsent = await post({ consent: { personalData: false } }).expect(422);
    expect(noConsent.body.error.code).toBe('order.consent_required');
    const unavailable = await post({}, [{ dishId: stopped.dishId, quantity: 2 }]).expect(422);
    expect(unavailable.body.error.code).toBe('catalog.dish_unavailable');

    const quote = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'delivery', items: [{ dishId: dish.dishId, quantity: 1 }, { dishId: stopped.dishId, quantity: 1 }] })
      .expect(200);
    expect(quote.body.lines.map((l: { available: boolean; problem: string | null }) => [l.available, l.problem])).toEqual([
      [true, null],
      [false, 'catalog.dish_unavailable'],
    ]);
    expect(quote.body.problems).toEqual(['catalog.dish_unavailable', 'order.address_required']);
    expect(quote.body.canCheckout).toBe(false);

    const noPickup = await setupBranch(ctx, { acceptsPickup: false, paymentMethods: ['online'] });
    const pickup = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(noPickup, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' }))
      .expect(422);
    expect(pickup.body.error.code).toBe('order.type_not_accepted');
    await addZone(ctx, noPickup);
    const method = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(noPickup, [{ dishId: dish.dishId, quantity: 5 }], { paymentMethod: 'on_receipt' }))
      .expect(422);
    expect(method.body.error.code).toBe('order.payment_method_not_accepted');
    const inactive = await createBranch(ctx.t, { isActive: false });
    const closed = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(inactive, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' }))
      .expect(422);
    expect(closed.body.error.code).toBe('order.branch_inactive');
    await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(newId(), [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' }))
      .expect(404);
  });

  it('ASAP only when the branch is open and the kitchen fits before closing; scheduled time is validated', async () => {
    const dish = addDish(ctx, 'Плов', 3_000);
    const post = (overrides: Record<string, unknown>) =>
      api().post('/api/v1/public/orders').send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', ...overrides }));
    // 01:00 по Астане — филиал закрыт (10:00–00:00).
    ctx.t.clock.set(zonedTimeToUtc('2026-10-02', '01:00', 'Asia/Almaty'));
    expect((await post({}).expect(422)).body.error.code).toBe('order.branch_closed');
    // 23:45 — самовывоз готовится 30 минут, до закрытия не успеть.
    ctx.t.clock.set(zonedTimeToUtc('2026-10-01', '23:45', 'Asia/Almaty'));
    expect((await post({}).expect(422)).body.error.code).toBe('order.asap_closing_soon');

    ctx.t.clock.set(zonedTimeToUtc('2026-10-01', '11:00', 'Asia/Almaty'));
    const tooEarly = await post({ scheduledFor: zonedTimeToUtc('2026-10-01', '11:15', 'Asia/Almaty').toISOString() }).expect(422);
    expect(tooEarly.body.error.code).toBe('order.schedule_too_early');
    const night = await post({ scheduledFor: zonedTimeToUtc('2026-10-02', '03:00', 'Asia/Almaty').toISOString() }).expect(422);
    expect(night.body.error.code).toBe('order.schedule_outside_hours');
    const tooFar = await post({ scheduledFor: zonedTimeToUtc('2026-10-20', '12:00', 'Asia/Almaty').toISOString() }).expect(422);
    expect(tooFar.body.error.code).toBe('order.schedule_too_far');
    const at = zonedTimeToUtc('2026-10-01', '19:30', 'Asia/Almaty');
    const ok = await post({ scheduledFor: at.toISOString() }).expect(201);
    const tracking = await api().get(`/api/v1/public/orders/${ok.body.publicToken}`).expect(200);
    expect(tracking.body).toMatchObject({ scheduledFor: at.toISOString(), promisedAt: at.toISOString() });
  });

  it('gift certificate pays part of the order first, the rest online; full coverage pays the order at once', async () => {
    const dish = addDish(ctx, 'Плов', 5_000);
    ctx.fakes.certificates.add('ABCD-EFGH-JK12', 200_000);
    const quote = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 1 }], certificateCode: 'ABCD-EFGH-JK12' })
      .expect(200);
    expect(quote.body.certificate).toMatchObject({ applied: true, maskedCode: '****-****-JK12', amount: { amount: 200_000 } });
    expect(quote.body.amountDue).toEqual({ amount: 300_000, currency: 'KZT' });
    const unknown = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 1 }], certificateCode: 'ZZZZ-ZZZZ-ZZZZ' })
      .expect(200);
    expect(unknown.body.certificate).toMatchObject({ applied: false, reason: 'order.certificate_not_found' });

    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', certificateCode: 'ABCD-EFGH-JK12' }))
      .expect(201);
    expect(res.body).toMatchObject({ status: 'awaiting_payment', payment: { method: 'online', amount: { amount: 300_000 } } });
    const payments = paymentsOf(ctx, res.body.orderId);
    expect(payments.map((p) => [p.method, p.amount.amount, p.status])).toEqual([
      ['gift_certificate', 200_000, 'succeeded'],
      ['online', 300_000, 'created'],
    ]);
    // Событие о списании с сертификата не делает заказ оплаченным: не хватает остатка.
    await paymentSucceeded(ctx, payments[0]!.id);
    expect((await api().get(`/api/v1/public/orders/${res.body.publicToken}`)).body.status).toBe('awaiting_payment');
    await paymentSucceeded(ctx, res.body.payment.id);
    const tracking = await api().get(`/api/v1/public/orders/${res.body.publicToken}`).expect(200);
    expect(tracking.body).toMatchObject({ status: 'paid', payment: { certificateAmount: { amount: 200_000 }, amountDue: { amount: 300_000 } } });

    ctx.fakes.certificates.add('WXYZ-WXYZ-9999', 1_000_000);
    const full = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', certificateCode: 'WXYZ-WXYZ-9999' }))
      .expect(201);
    expect(full.body).toMatchObject({ status: 'paid', payment: null });
    expect((await api().get(`/api/v1/public/orders/${full.body.publicToken}`).expect(200)).body).toMatchObject({ isPaidOnline: true, payment: { amountDue: { amount: 0 } } });
    expect((await ctx.t.get(OrderQuery).getKitchenOrder(full.body.orderId)).isPaidOnline).toBe(true);
  });

  it('promo code: discount in quote and checkout, usage reserved then used after payment; invalid code rejects checkout', async () => {
    const dish = addDish(ctx, 'Плов', 5_000);
    const promo = await addPromo(ctx, { code: 'SALE10', percentBp: 1_000 });
    const quote = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 2 }], promoCode: 'sale10' })
      .expect(200);
    expect(quote.body.promo).toMatchObject({ code: 'SALE10', applied: true, discount: { amount: 100_000 } });
    expect(quote.body.total).toEqual({ amount: 900_000, currency: 'KZT' });
    const wrong = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 2 }], promoCode: 'NOPE' })
      .expect(200);
    expect(wrong.body.promo).toMatchObject({ applied: false, reason: 'promo.not_found' });
    expect(wrong.body.total).toEqual({ amount: 1_000_000, currency: 'KZT' });

    const rejected = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 2 }], { type: 'pickup', promoCode: 'NOPE' }))
      .expect(422);
    expect(rejected.body.error.code).toBe('promo.not_found');

    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 2 }], { type: 'pickup', promoCode: 'SALE10' }))
      .expect(201);
    expect(res.body.total).toEqual({ amount: 900_000, currency: 'KZT' });
    const owner = await staff(ctx, 'owner');
    const before = await api().get(`/api/v1/admin/promo-codes/${promo.id}`).set('Authorization', owner).expect(200);
    expect(before.body.usage).toEqual({ reserved: 1, used: 0, released: 0 });
    await paymentSucceeded(ctx, res.body.payment.id);
    const after = await api().get(`/api/v1/admin/promo-codes/${promo.id}`).set('Authorization', owner).expect(200);
    expect(after.body.usage).toEqual({ reserved: 0, used: 1, released: 0 });
    const placed = await publishedEvents(ctx.t, OrderingEvents.OrderPlaced);
    expect(placed[0]!.payload).toMatchObject({ promoCode: 'SALE10', discount: { amount: 100_000 } });
  });

  it('free delivery promo removes the zone fee; threshold makes delivery free too', async () => {
    const dish = addDish(ctx, 'Плов', 5_000);
    await addZone(ctx, branchId);
    await addPromo(ctx, { code: 'FREESHIP', kind: 'free_delivery', percentBp: null });
    const base = { branchId, type: 'delivery', point: { lat: 51.1, lng: 71.42 } };
    const withPromo = await api()
      .post('/api/v1/public/orders/quote')
      .send({ ...base, items: [{ dishId: dish.dishId, quantity: 1 }], promoCode: 'FREESHIP' })
      .expect(200);
    expect(withPromo.body).toMatchObject({ deliveryFee: { amount: 0 }, total: { amount: 500_000 }, delivery: { freeDeliveryReason: 'promo' } });
    const threshold = await api()
      .post('/api/v1/public/orders/quote')
      .send({ ...base, items: [{ dishId: dish.dishId, quantity: 4 }] })
      .expect(200);
    expect(threshold.body).toMatchObject({ deliveryFee: { amount: 0 }, delivery: { freeDeliveryReason: 'threshold' } });
    const pickup = await api()
      .post('/api/v1/public/orders/quote')
      .send({ branchId, type: 'pickup', items: [{ dishId: dish.dishId, quantity: 1 }], promoCode: 'FREESHIP' })
      .expect(200);
    expect(pickup.body.promo).toMatchObject({ applied: false, reason: 'promo.not_applicable' });
  });

  it('retry online payment after a failed attempt while the order waits for payment', async () => {
    const dish = addDish(ctx, 'Плов', 3_000);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody(branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup' }))
      .expect(201);
    const same = await api().post(`/api/v1/public/orders/${res.body.publicToken}/pay`).expect(200);
    expect(same.body.id).toBe(res.body.payment.id);
    ctx.fakes.payments.payments.get(res.body.payment.id)!.status = 'failed';
    const tracking = await api().get(`/api/v1/public/orders/${res.body.publicToken}`).expect(200);
    expect(tracking.body.payment).toMatchObject({ canRetry: true, current: { status: 'failed' } });
    const retried = await api().post(`/api/v1/public/orders/${res.body.publicToken}/pay`).expect(200);
    expect(retried.body.id).not.toBe(res.body.payment.id);
    expect(retried.body).toMatchObject({ method: 'online', status: 'created', amount: { amount: 300_000 } });
    expect(retried.body.paymentUrl).toContain(`order:${res.body.orderId}:online:2`);
    await paymentSucceeded(ctx, retried.body.id);
    const paid = await api().post(`/api/v1/public/orders/${res.body.publicToken}/pay`).expect(409);
    expect(paid.body.error.code).toBe('order.not_awaiting_payment');
    await api().get('/api/v1/public/orders/unknown-token').expect(404);
  });
});
