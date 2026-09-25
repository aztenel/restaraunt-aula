import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Money } from '../../shared/kernel/money';
import { formatMoney } from './domain/order-texts';
import { OrderingEvents } from './public';
import {
  addDish,
  addPromo,
  auditActions,
  checkoutBody,
  createOrderingTestApp,
  OrderingTestContext,
  paymentsOf,
  paymentSucceeded,
  publishedEvents,
  refundResult,
  setupBranch,
  staff,
} from './testing/ordering-test-kit';
import { AUTO_CANCEL_SCHEDULE } from './application/auto-cancel-unpaid-orders.action';

describe('Ordering: cancellation, rejection and refunds (integration)', () => {
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
  const minutes = (n: number) => n * 60_000;

  async function placeOnline(overrides: Record<string, unknown> = {}, priceTenge = 5_000) {
    const dish = addDish(ctx, `Блюдо ${Math.random()}`, priceTenge);
    const res = await api()
      .post('/api/v1/public/orders')
      .send(checkoutBody((overrides.branchId as string) ?? branchId, [{ dishId: dish.dishId, quantity: 1 }], { type: 'pickup', ...overrides }))
      .expect(201);
    return res.body as { orderId: string; publicToken: string; number: string; payment: { id: string } | null; status: string };
  }

  async function placePaid(overrides: Record<string, unknown> = {}, priceTenge = 5_000) {
    const order = await placeOnline(overrides, priceTenge);
    await paymentSucceeded(ctx, order.payment!.id);
    return order;
  }

  const status = async (token: string) => (await api().get(`/api/v1/public/orders/${token}`).expect(200)).body.status;
  const action = (orderId: string, name: string, auth: string, body: Record<string, unknown> = {}) =>
    api().post(`/api/v1/admin/orders/${orderId}/${name}`).set('Authorization', auth).send(body);

  it('auto-cancels unpaid orders after the branch timeout: payment cancelled, promo released, certificate returned', async () => {
    await addPromo(ctx, { code: 'SALE10' });
    ctx.fakes.certificates.add('CERT-0000-0001', 100_000);
    const order = await placeOnline({ promoCode: 'SALE10', certificateCode: 'CERT-0000-0001' });
    const [certificate, online] = paymentsOf(ctx, order.orderId);
    expect(certificate!.method).toBe('gift_certificate');

    ctx.t.clock.advance(minutes(19));
    await ctx.t.runSchedule(AUTO_CANCEL_SCHEDULE);
    expect(await status(order.publicToken)).toBe('awaiting_payment');

    ctx.t.clock.advance(minutes(2));
    await ctx.t.runSchedule(AUTO_CANCEL_SCHEDULE);
    await ctx.t.drain();
    expect(await status(order.publicToken)).toBe('cancelled');
    expect(online!.status).toBe('cancelled');
    expect(ctx.fakes.payments.refunds.map((r) => [r.paymentId, r.amount.amount])).toEqual([[certificate!.id, 100_000]]);
    const cancelled = await publishedEvents(ctx.t, OrderingEvents.OrderCancelled);
    expect(cancelled[0]!.payload).toMatchObject({ orderId: order.orderId, reasonCode: 'not_paid_in_time', wasPaid: false });
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'order.cancelled')?.dedupeKey).toBe(`order:${order.orderId}:cancelled`);
    const owner = await staff(ctx, 'owner');
    const promos = await api().get('/api/v1/admin/promo-codes').set('Authorization', owner).expect(200);
    expect(promos.body.items[0].usage).toEqual({ reserved: 0, used: 0, released: 1 });

    // Сертификат вернулся — все запрошенные возвраты прошли: cancelled -> refunded.
    await refundResult(ctx, ctx.fakes.payments.refunds[0]!.id);
    expect(await status(order.publicToken)).toBe('refunded');
    expect(ctx.fakes.notifier.guest.find((g) => g.template === 'order.refunded')).toMatchObject({
      params: { number: order.number, amount: formatMoney(Money.tenge(1_000)) },
    });
    const details = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', owner).expect(200);
    expect(details.body.history.map((h: { to: string; actorName: string }) => h.to)).toEqual(['awaiting_payment', 'cancelled', 'refunded']);
    expect(details.body.cancellation).toEqual({ reasonCode: 'not_paid_in_time', reason: null });
  });

  it('late payment after auto-cancel is refunded in full; the refund moves the order to refunded', async () => {
    const fast = await setupBranch(ctx, { awaitingPaymentTimeoutMinutes: 5 });
    const order = await placeOnline({ branchId: fast });
    ctx.t.clock.advance(minutes(6));
    await ctx.t.runSchedule(AUTO_CANCEL_SCHEDULE);
    expect(await status(order.publicToken)).toBe('cancelled');
    expect(ctx.fakes.payments.refunds).toHaveLength(0);

    await paymentSucceeded(ctx, order.payment!.id, { previousStatus: 'cancelled' });
    expect(await status(order.publicToken)).toBe('cancelled');
    expect(ctx.fakes.payments.refunds.map((r) => [r.paymentId, r.amount.amount])).toEqual([[order.payment!.id, 500_000]]);
    expect(await auditActions(ctx.t, order.orderId)).toContain('order.late_payment');
    // Повторная доставка того же факта оплаты не запрашивает второй возврат.
    await paymentSucceeded(ctx, order.payment!.id);
    expect(ctx.fakes.payments.refunds).toHaveLength(1);

    await refundResult(ctx, ctx.fakes.payments.refunds[0]!.id);
    expect(await status(order.publicToken)).toBe('refunded');
  });

  it('reject: paid -> accepted -> cancelled in one transaction, full refund, then refunded', async () => {
    const order = await placePaid();
    const operator = await staff(ctx, 'branch_operator', branchId);
    const res = await action(order.orderId, 'reject', operator, { reasonCode: 'out_of_stock', reason: 'Закончилась баранина' }).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancellation: { reasonCode: 'out_of_stock', reason: 'Закончилась баранина' } });
    expect(res.body.history.map((h: { from: string | null; to: string }) => `${h.from}>${h.to}`)).toEqual([
      'draft>awaiting_payment',
      'awaiting_payment>paid',
      'paid>accepted',
      'accepted>cancelled',
    ]);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({ kind: 'cancellation', status: 'pending', amount: { amount: 500_000 } });
    const statuses = (await publishedEvents(ctx.t, OrderingEvents.OrderStatusChanged)).map((e) => `${e.payload.from}>${e.payload.to}`);
    expect(statuses.slice(-2)).toEqual(['paid>accepted', 'accepted>cancelled']);
    expect((await publishedEvents(ctx.t, OrderingEvents.OrderCancelled))[0]!.payload).toMatchObject({ wasPaid: true, reasonCode: 'out_of_stock' });
    const guest = ctx.fakes.notifier.guest.map((g) => g.template);
    expect(guest).toContain('order.cancelled');
    expect(guest).not.toContain('order.accepted');
    expect((await auditActions(ctx.t, order.orderId)).filter((a) => a === 'order.status_changed')).toHaveLength(4);

    await refundResult(ctx, res.body.refunds[0].refundId);
    expect(await status(order.publicToken)).toBe('refunded');
    const again = await action(order.orderId, 'reject', operator, { reasonCode: 'other' }).expect(409);
    expect(again.body.error.code).toBe('order.invalid_transition');
  });

  it('cancel an accepted order: full refund by an operator, partial refund needs orders.refund', async () => {
    const operator = await staff(ctx, 'branch_operator', branchId);
    const manager = await staff(ctx, 'branch_manager', branchId);

    const partial = await placePaid();
    await action(partial.orderId, 'transition', operator, { to: 'accepted' }).expect(200);
    const forbidden = await action(partial.orderId, 'cancel', operator, { reasonCode: 'guest_request', refundAmount: { amount: 100_000 } }).expect(403);
    expect(forbidden.body.error.code).toBe('access.forbidden');
    const res = await action(partial.orderId, 'cancel', manager, {
      reasonCode: 'guest_request',
      reason: 'Гость передумал, блюдо уже готовится',
      refundAmount: { amount: 300_000 },
    }).expect(200);
    expect(res.body.refunds.map((r: { amount: { amount: number } }) => r.amount.amount)).toEqual([300_000]);
    // Удержанная рестораном часть остаётся на платеже; отменённый заказ частично не возвращается.
    expect(res.body).toMatchObject({ refundable: { amount: 200_000 }, canRefund: false });
    await refundResult(ctx, res.body.refunds[0].refundId);
    expect(await status(partial.publicToken)).toBe('refunded');

    const full = await placePaid();
    await action(full.orderId, 'transition', operator, { to: 'accepted' }).expect(200);
    const cancelled = await action(full.orderId, 'cancel', operator, { reasonCode: 'cannot_deliver' }).expect(200);
    expect(cancelled.body.refunds.map((r: { amount: { amount: number } }) => r.amount.amount)).toEqual([500_000]);

    const paidOnly = await placePaid();
    const useReject = await action(paidOnly.orderId, 'cancel', operator, { reasonCode: 'other' }).expect(409);
    expect(useReject.body.error.code).toBe('order.use_reject');
    await action(paidOnly.orderId, 'transition', operator, { to: 'accepted' }).expect(200);
    await action(paidOnly.orderId, 'transition', operator, { to: 'cooking' }).expect(200);
    const cooking = await action(paidOnly.orderId, 'cancel', operator, { reasonCode: 'other' }).expect(409);
    expect(cooking.body.error.code).toBe('order.invalid_transition');
    await action(paidOnly.orderId, 'cancel', operator, { reasonCode: 'nonsense' }).expect(400);
  });

  it('cancel before payment: payment cancelled, promo released, no refund, order stays cancelled', async () => {
    await addPromo(ctx, { code: 'SALE10' });
    const order = await placeOnline({ promoCode: 'SALE10' });
    const operator = await staff(ctx, 'branch_operator', branchId);
    const res = await action(order.orderId, 'cancel', operator, { reasonCode: 'duplicate' }).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', refunds: [], wasPaid: false });
    expect(ctx.fakes.payments.payments.get(order.payment!.id)!.status).toBe('cancelled');
    const badAmount = await action(order.orderId, 'cancel', operator, { reasonCode: 'duplicate' }).expect(409);
    expect(badAmount.body.error.code).toBe('order.invalid_transition');
  });

  it('on_receipt order cancellation does not need a refund', async () => {
    const branch = await setupBranch(ctx, { requirePhoneVerificationForOnReceipt: false });
    const order = await placeOnline({ branchId: branch, paymentMethod: 'on_receipt' });
    expect(order.status).toBe('paid');
    const manager = await staff(ctx, 'branch_manager', branch);
    await action(order.orderId, 'transition', manager, { to: 'accepted' }).expect(200);
    const res = await action(order.orderId, 'cancel', manager, { reasonCode: 'guest_request' }).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', refunds: [] });
    expect(ctx.fakes.payments.payments.get(order.payment!.id)!.status).toBe('cancelled');
  });

  it('partial refund of a completed order keeps the status; limits and permissions are checked', async () => {
    const order = await placePaid({}, 8_000);
    const operator = await staff(ctx, 'branch_operator', branchId);
    const manager = await staff(ctx, 'branch_manager', branchId);
    for (const to of ['accepted', 'cooking', 'ready', 'completed']) await action(order.orderId, 'transition', operator, { to }).expect(200);

    await action(order.orderId, 'refund', operator, { amount: { amount: 50_000 }, reason: 'Недовложение' }).expect(403);
    const res = await action(order.orderId, 'refund', manager, { amount: { amount: 50_000 }, reason: 'Недовложение соуса' }).expect(200);
    expect(res.body).toMatchObject({ status: 'completed', refundable: { amount: 750_000 }, canRefund: true });
    expect(res.body.refunds[0]).toMatchObject({ kind: 'partial', status: 'pending', amount: { amount: 50_000 }, reason: 'Недовложение соуса' });
    const tooMuch = await action(order.orderId, 'refund', manager, { amount: { amount: 800_000 }, reason: 'Всё' }).expect(422);
    expect(tooMuch.body.error.code).toBe('order.refund_exceeds_paid');
    await refundResult(ctx, res.body.refunds[0].refundId);
    const after = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', manager).expect(200);
    expect(after.body).toMatchObject({ status: 'completed', refunds: [{ status: 'succeeded' }] });
    expect(await auditActions(ctx.t, order.orderId)).toEqual(expect.arrayContaining(['order.refund_requested', 'order.refund_succeeded']));

    const unpaid = await placeOnline();
    const notAllowed = await action(unpaid.orderId, 'refund', manager, { amount: { amount: 10_000 }, reason: 'x' }).expect(409);
    expect(notAllowed.body.error.code).toBe('order.refund_not_allowed');
  });

  it('failed refund keeps the order cancelled until a later refund of that payment succeeds', async () => {
    const order = await placePaid();
    const manager = await staff(ctx, 'branch_manager', branchId);
    const rejected = await action(order.orderId, 'reject', manager, { reasonCode: 'cannot_deliver' }).expect(200);
    await refundResult(ctx, rejected.body.refunds[0].refundId, 'failed');
    expect(await status(order.publicToken)).toBe('cancelled');
    expect(ctx.fakes.adminFeed.events.at(-1)).toMatchObject({ entityId: order.orderId, sound: true });
    // Финансист повторил возврат в разделе платежей — возврат «извне» заказа.
    const retry = await ctx.fakes.payments.requestRefund({ paymentId: order.payment!.id, reason: 'повтор', idempotencyKey: 'manual-retry' });
    await refundResult(ctx, retry.id);
    expect(await status(order.publicToken)).toBe('refunded');
    const details = await api().get(`/api/v1/admin/orders/${order.orderId}`).set('Authorization', manager).expect(200);
    expect(details.body.refunds.map((r: { kind: string; status: string }) => `${r.kind}:${r.status}`)).toEqual(['cancellation:failed', 'external:succeeded']);
  });

  it('a duplicate online payment of an already paid order is refunded', async () => {
    const order = await placeOnline();
    ctx.fakes.payments.payments.get(order.payment!.id)!.status = 'failed';
    const retried = await api().post(`/api/v1/public/orders/${order.publicToken}/pay`).expect(200);
    await paymentSucceeded(ctx, retried.body.id);
    expect(await status(order.publicToken)).toBe('paid');
    // Провайдер всё же списал деньги по первой ссылке.
    await paymentSucceeded(ctx, order.payment!.id, { previousStatus: 'failed' });
    expect(ctx.fakes.payments.refunds.map((r) => [r.paymentId, r.amount.amount])).toEqual([[order.payment!.id, 500_000]]);
    expect(await status(order.publicToken)).toBe('paid');
  });

  it('forbidden transitions answer 409 with order.invalid_transition', async () => {
    const order = await placeOnline();
    const operator = await staff(ctx, 'branch_operator', branchId);
    const early = await action(order.orderId, 'transition', operator, { to: 'accepted' }).expect(409);
    expect(early.body.error).toMatchObject({ code: 'order.invalid_transition', details: { from: 'awaiting_payment', to: 'accepted' } });
    await paymentSucceeded(ctx, order.payment!.id);
    await action(order.orderId, 'transition', operator, { to: 'cooking' }).expect(409);
    await action(order.orderId, 'transition', operator, { to: 'accepted' }).expect(200);
    await action(order.orderId, 'transition', operator, { to: 'completed' }).expect(409);
    await action(order.orderId, 'transition', operator, { to: 'cancelled' }).expect(400);
    await action(order.orderId, 'transition', operator, { to: 'paid' }).expect(400);
  });
});
