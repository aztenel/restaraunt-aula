import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditLog,
  createE2eApp,
  deliveries,
  E2E_TODAY,
  E2eContext,
  feed,
  lateProviderCapture,
  money,
  outboxEvents,
  pendingOutbox,
  sandboxPay,
} from './support/e2e-app';
import { adminOrder, advanceOrder, customerByPhone, GUEST_PHONE, paymentsOf, placeOrder, report, storefrontMenu, tracking } from './support/ordering';

describe('E2E 3–4: order cancellations and refunds across Ordering / Payments / Reporting', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  async function onlinePickup(quantity = 1) {
    const menu = await storefrontMenu(ctx, 'greenline');
    const lagman = menu.get('lagman')!;
    const placed = await placeOrder(ctx, {
      branchId: ctx.seed.branches.greenline,
      type: 'pickup',
      items: [{ dishId: lagman.id, quantity }],
      paymentMethod: 'online',
    });
    await ctx.drain();
    const track = await tracking(ctx, placed.publicToken);
    expect(track.payment.current.paymentUrl).toContain('/public/payments/sandbox/');
    return { ...placed, paymentUrl: track.payment.current.paymentUrl as string, lagman };
  }

  it('3: unpaid online order is auto-cancelled after the branch timeout; a late provider payment is refunded automatically', async () => {
    const { greenline } = ctx.seed.branches;
    const order = await onlinePickup(2); // 3 400 * 2 = 6 800 ₸

    // 19 минут — ещё ждём оплату (таймаут филиала 20 минут).
    ctx.t.clock.advance(19 * 60_000);
    await ctx.t.runSchedule('ordering.auto_cancel_unpaid');
    await ctx.drain();
    expect((await tracking(ctx, order.publicToken)).status).toBe('awaiting_payment');

    ctx.t.clock.advance(2 * 60_000);
    await ctx.t.runSchedule('ordering.auto_cancel_unpaid');
    await ctx.drain();
    let track = await tracking(ctx, order.publicToken);
    expect(track).toMatchObject({ status: 'cancelled', cancellation: { reasonCode: 'not_paid_in_time' }, payment: { isPaid: false, canRetry: false } });
    let [payment] = await paymentsOf(ctx, order.orderId);
    expect(payment).toMatchObject({ status: 'cancelled', method: 'online' });
    // Гостю — уведомление об отмене; в отчёте причин — not_paid_in_time.
    expect((await deliveries(ctx, { relatedId: order.orderId, template: 'order.cancelled' })).map((d) => d.status)).toEqual(['sent']);
    const cancelledEvents = (await outboxEvents(ctx, 'ordering.order_cancelled')).filter((e) => e.payload.orderId === order.orderId);
    expect(cancelledEvents.map((e) => [e.payload.reasonCode, e.payload.wasPaid])).toEqual([['not_paid_in_time', false]]);

    // Страница оплаты отменённого платежа больше не принимает оплату.
    const page = await ctx.api().get(new URL(order.paymentUrl).pathname.replace(/^.*\/api\/v1/, '/api/v1')).query({ sig: new URL(order.paymentUrl).searchParams.get('sig') }).expect(200);
    expect(page.text).not.toContain('Оплатить');

    // Провайдер всё-таки списал деньги (гость оплатил до отзыва ссылки) и сообщает об этом вебхуком.
    await lateProviderCapture(ctx, payment);
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);

    [payment] = await paymentsOf(ctx, order.orderId);
    expect(payment).toMatchObject({ status: 'refunded', refundedAmount: money(6_800) });
    track = await tracking(ctx, order.publicToken);
    expect(track.status).toBe('refunded');
    expect(track.timeline.map((h: any) => h.status)).toEqual(['awaiting_payment', 'cancelled', 'refunded']);
    const succeeded = (await outboxEvents(ctx, 'payments.payment_succeeded')).filter((e) => e.payload.referenceId === order.orderId);
    expect(succeeded.map((e) => e.payload.previousStatus)).toEqual(['cancelled']);

    const owner = await ctx.owner();
    const details = await adminOrder(ctx, order.orderId, owner);
    expect(details.refunds).toEqual([expect.objectContaining({ kind: 'late_payment', status: 'succeeded', amount: money(6_800) })]);
    const orderAudit = (await auditLog(ctx, { entityId: order.orderId })).map((a) => a.action);
    expect(orderAudit).toEqual(expect.arrayContaining(['order.late_payment', 'order.refund_requested', 'order.refund_succeeded']));
    expect((await deliveries(ctx, { relatedId: order.orderId, template: 'order.refunded' })).map((d) => d.status)).toEqual(['sent']);
    expect((await feed(ctx)).some((f) => f.entityId === order.orderId && f.title.includes('оплата после отмены'))).toBe(true);

    // Отчёты: причина отмены, выручки нет, поступление и возврат — в движении денег.
    const cancelled = await report(ctx, 'cancelled-orders', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cancelled).toMatchObject({ placed: 1, cancelled: 1, cancelledTotal: money(6_800) });
    expect(cancelled.reasons).toEqual([expect.objectContaining({ reasonCode: 'not_paid_in_time', count: 1, paidCount: 0, total: money(6_800) })]);
    expect(cancelled.orders.items).toEqual([expect.objectContaining({ orderId: order.orderId, reasonCode: 'not_paid_in_time', wasPaid: false })]);
    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.totals).toMatchObject({ total: money(0), refunds: money(0) });
    const cash = await report(ctx, 'payments', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cash.totals).toMatchObject({ received: money(6_800), refunded: money(6_800), net: money(0) });

    const guest = await customerByPhone(ctx, GUEST_PHONE);
    expect(guest.customer).toMatchObject({ ordersCount: 1, completedOrdersCount: 0, totalSpent: money(0) });
    expect(guest.activities.items.map((a: any) => a.type)).toEqual(expect.arrayContaining(['order_placed', 'order_cancelled']));
  });

  it('4: restaurant rejects a paid order (paid → accepted → cancelled) with a partial refund by a user with orders.refund', async () => {
    const { greenline } = ctx.seed.branches;
    const order = await onlinePickup(3); // 3 400 * 3 = 10 200 ₸
    await sandboxPay(ctx, order.paymentUrl);
    await ctx.drain();
    expect((await tracking(ctx, order.publicToken)).status).toBe('paid');

    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL');
    const manager = await ctx.staff([{ role: 'branch_manager', branchId: greenline }], 'Управляющий GL');
    let details = await adminOrder(ctx, order.orderId, manager.auth);
    expect(details).toMatchObject({ status: 'paid', canReject: true, canCancel: false, refundable: money(10_200) });

    // Оплаченный заказ не «отменяют», а отклоняют (схема ТЗ не допускает paid → cancelled).
    const cancelPaid = await ctx.api().post(`/api/v1/admin/orders/${order.orderId}/cancel`).set('Authorization', manager.auth).send({ reasonCode: 'out_of_stock' });
    expect(cancelPaid.status).toBe(409);
    expect(cancelPaid.body.error.code).toBe('order.use_reject');
    // Частичная сумма возврата — только с правом orders.refund (у оператора его нет).
    const operatorPartial = await ctx
      .api()
      .post(`/api/v1/admin/orders/${order.orderId}/reject`)
      .set('Authorization', operator.auth)
      .send({ reasonCode: 'out_of_stock', reason: 'Закончилась лапша', refundAmount: { amount: 700_000 } });
    expect(operatorPartial.status).toBe(403);
    expect((await adminOrder(ctx, order.orderId, manager.auth)).status).toBe('paid');

    // Управляющий удерживает стоимость уже приготовленного (3 200 ₸) и возвращает 7 000 ₸.
    const rejected = await ctx
      .api()
      .post(`/api/v1/admin/orders/${order.orderId}/reject`)
      .set('Authorization', manager.auth)
      .send({ reasonCode: 'out_of_stock', reason: 'Закончилась лапша', refundAmount: { amount: 700_000, currency: 'KZT' } })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'cancelled', cancellation: { reasonCode: 'out_of_stock' } });
    expect(rejected.body.refunds).toEqual([expect.objectContaining({ kind: 'cancellation', status: 'pending', amount: money(7_000) })]);
    expect(rejected.body.history.map((h: any) => h.to)).toEqual(['awaiting_payment', 'paid', 'accepted', 'cancelled']);

    // Возврат исполняется задачей платёжного модуля через провайдера (песочница).
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    details = await adminOrder(ctx, order.orderId, manager.auth);
    expect(details.status).toBe('refunded');
    expect(details.refunds).toEqual([expect.objectContaining({ status: 'succeeded', amount: money(7_000) })]);
    const [payment] = await paymentsOf(ctx, order.orderId);
    expect(payment).toMatchObject({ status: 'partially_refunded', refundedAmount: money(7_000), amount: money(10_200) });
    const refunds = await ctx.api().get('/api/v1/admin/payments/refunds').set('Authorization', await ctx.owner()).expect(200);
    expect(refunds.body.items).toEqual(expect.arrayContaining([expect.objectContaining({ paymentId: payment.id, status: 'succeeded', amount: money(7_000) })]));

    // Журнал: оба перехода отказа выполнены управляющим, затем возврат и refunded от платёжного модуля.
    const audit = await auditLog(ctx, { entityId: order.orderId });
    const transitions = audit.filter((a) => a.action === 'order.status_changed').map((a) => [`${a.before.status}>${a.after.status}`, a.actorUserId]);
    expect(transitions).toEqual([
      ['draft>awaiting_payment', null],
      ['awaiting_payment>paid', null],
      ['paid>accepted', manager.userId],
      ['accepted>cancelled', manager.userId],
      ['cancelled>refunded', null],
    ]);
    const refundRequested = audit.find((a) => a.action === 'order.refund_requested')!;
    expect(refundRequested).toMatchObject({ actorUserId: manager.userId, after: { kind: 'cancellation', amount: money(7_000) } });
    expect(audit.map((a) => a.action)).toContain('order.refund_succeeded');
    const paymentAudit = (await auditLog(ctx, { entityId: payment.id })).map((a) => a.action);
    expect(paymentAudit).toEqual(['payment.created', 'payment.initiated', 'payment.succeeded', 'refund.requested', 'refund.succeeded']);

    // Гостю не сообщаем о промежуточном «принят», сообщаем об отмене и возврате.
    const guestTemplates = (await deliveries(ctx, { relatedId: order.orderId, audience: 'guest' })).map((d) => d.template).sort();
    expect(guestTemplates).toEqual(['order.cancelled', 'order.created', 'order.paid', 'order.refunded']);

    // Отчёты: причина (оплаченный заказ), выручки нет (не выполнен); поступление 10 200, возврат 7 000.
    const cancelled = await report(ctx, 'cancelled-orders', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cancelled.reasons).toEqual([expect.objectContaining({ reasonCode: 'out_of_stock', count: 1, paidCount: 1 })]);
    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.totals.total).toEqual(money(0));
    const cash = await report(ctx, 'payments', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(cash.totals).toMatchObject({ received: money(10_200), refunded: money(7_000), net: money(3_200) });
  });

  it('4b: partial refund on a completed order reduces revenue of the refund day; status stays completed', async () => {
    const { greenline } = ctx.seed.branches;
    const order = await onlinePickup(1); // 3 400 ₸
    await sandboxPay(ctx, order.paymentUrl);
    await ctx.drain();
    const manager = await ctx.staff([{ role: 'branch_manager', branchId: greenline }], 'Управляющий GL');
    for (const to of ['accepted', 'cooking', 'ready', 'completed']) await advanceOrder(ctx, order.orderId, manager.auth, to);
    await ctx.drain();
    await ctx
      .api()
      .post(`/api/v1/admin/orders/${order.orderId}/refund`)
      .set('Authorization', manager.auth)
      .send({ amount: { amount: 50_000 }, reason: 'Недовложение: не положили соус' })
      .expect(200);
    await ctx.drain();
    const details = await adminOrder(ctx, order.orderId, manager.auth);
    expect(details).toMatchObject({ status: 'completed', refundable: money(2_900) });
    expect(details.refunds).toEqual([expect.objectContaining({ kind: 'partial', status: 'succeeded', amount: money(500) })]);
    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.totals).toMatchObject({ pickup: money(2_900), refunds: money(-500), total: money(2_900) });
    const guest = await customerByPhone(ctx, GUEST_PHONE);
    expect(guest.customer.totalSpent).toEqual(money(2_900));
  });
});
