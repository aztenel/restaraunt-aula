import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, E2eContext, feed, idem, lateProviderCapture, money, pendingOutbox, sandboxPay } from './support/e2e-app';
import { adminBanquetRequest, holdVenue, vipVenues } from './support/banquet';
import { paymentsOf, placeOrder, report, storefrontMenu, tracking } from './support/ordering';

/**
 * Дополнительно: неуспешные и «поздние» ветки между модулями — отказ в оплате и повтор, поздняя оплата
 * депозита снятой брони, отмена банкета после предоплаты с возвратом, перенос брони с напоминанием.
 */
describe('E2E extra: failure and late branches across modules', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('declined online payment keeps the order awaiting payment; the guest retries with a new link and pays', async () => {
    const menu = await storefrontMenu(ctx, 'greenline');
    const placed = await placeOrder(ctx, { branchId: ctx.seed.branches.greenline, type: 'pickup', items: [{ dishId: menu.get('kazy')!.id, quantity: 1 }], paymentMethod: 'online' });
    await ctx.drain();
    let track = await tracking(ctx, placed.publicToken);
    const firstUrl = track.payment.current.paymentUrl;
    await sandboxPay(ctx, firstUrl, 'failed');
    await ctx.drain();
    track = await tracking(ctx, placed.publicToken);
    expect(track).toMatchObject({ status: 'awaiting_payment', payment: { isPaid: false, canRetry: true, current: { status: 'failed' } } });

    const retry = await ctx.api().post(`/api/v1/public/orders/${placed.publicToken}/pay`).expect(200);
    expect(retry.body).toMatchObject({ method: 'online', status: 'created', amount: money(4_900) });
    await ctx.drain();
    track = await tracking(ctx, placed.publicToken);
    expect(track.payment.current.paymentUrl).not.toBe(firstUrl);
    await sandboxPay(ctx, track.payment.current.paymentUrl);
    await ctx.drain();
    expect((await tracking(ctx, placed.publicToken)).status).toBe('paid');
    const payments = await paymentsOf(ctx, placed.orderId);
    expect(payments.map((p) => p.status).sort()).toEqual(['failed', 'succeeded']);
    // Отказ провайдера — не повод отменять заказ; в очередь персонала (со звуком) заказ попадает один раз — после оплаты.
    expect((await feed(ctx)).filter((f) => f.entityId === placed.orderId && f.kind === 'created')).toHaveLength(1);
  });

  it('deposit captured by the provider after the hold expired is refunded automatically; the venue stays free', async () => {
    const { vip1 } = await vipVenues(ctx, '2026-10-03', '18:00');
    const booked = await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({ branchId: ctx.seed.branches.greenline, venueId: vip1, date: '2026-10-03', time: '18:00', guests: 8, customer: { name: 'Гость', phone: '+77015550001' }, consent: { personalData: true }, locale: 'ru', idempotencyKey: idem('resv') })
      .expect(201);
    await ctx.drain();
    ctx.t.clock.advance(31 * 60_000);
    await ctx.t.runSchedule('reservation.expire_holds');
    await ctx.drain();
    const owner = await ctx.owner();
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: booked.body.number }).set('Authorization', owner).expect(200);
    const reservationId = list.body.items[0].id;
    let [payment] = await paymentsOf(ctx, reservationId);
    expect(payment.status).toBe('cancelled');

    await lateProviderCapture(ctx, payment);
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    [payment] = await paymentsOf(ctx, reservationId);
    expect(payment).toMatchObject({ status: 'refunded', refundedAmount: money(50_000) });
    const detail = await ctx.api().get(`/api/v1/admin/reservations/${reservationId}`).set('Authorization', owner).expect(200);
    expect(detail.body).toMatchObject({ status: 'expired' });
    expect((await auditLog(ctx, { entityId: reservationId })).map((a) => a.action)).toContain('reservation.deposit_payment_refunded');
  });

  it('banquet cancelled after prepayment: finance refunds the invoice payment, hall is released, revenue is not affected', async () => {
    const { greenline } = ctx.seed.branches;
    const manager = await ctx.staff([{ role: 'banquet_manager' }], 'Банкетный менеджер (тест)');
    const finance = await ctx.staff([{ role: 'finance' }], 'Финансы');
    const { vip1 } = await vipVenues(ctx, '2026-10-12');
    const request = await adminBanquetRequest(ctx, manager.auth, { eventDate: '2026-10-12', guests: 10, branchId: greenline });
    const held = await holdVenue(ctx, manager.auth, request.id, vip1, '2026-10-12').expect(200);
    await ctx.api().post(`/api/v1/admin/banquets/requests/${request.id}/transition`).set('Authorization', manager.auth).send({ to: 'in_progress' }).expect(200);
    const quote = await ctx
      .api()
      .post(`/api/v1/admin/banquets/requests/${request.id}/quotes`)
      .set('Authorization', manager.auth)
      .send({ lines: [{ kind: 'other', title: { ru: 'Банкетное меню' }, unit: 'чел.', unitPrice: { amount: 1_000_000 }, quantity: 10 }] });
    expect(quote.status, JSON.stringify(quote.body)).toBe(201);
    await ctx.api().post(`/api/v1/admin/banquets/quotes/${quote.body.id}/send`).set('Authorization', manager.auth).expect(200);
    const detail = (await ctx.api().get(`/api/v1/admin/banquets/requests/${request.id}`).set('Authorization', manager.auth).expect(200)).body;
    const token = decodeURIComponent(new URL(detail.publicQuoteUrl).pathname.split('/').pop()!);
    await ctx.api().post(`/api/v1/public/banquets/quotes/${token}/accept`).send({ version: 1 }).expect(200);
    const invoice = await ctx.api().post(`/api/v1/admin/banquets/requests/${request.id}/invoices`).set('Authorization', manager.auth).send({ payerType: 'individual' }).expect(201);
    await ctx.drain();
    const invoiceToken = decodeURIComponent(new URL(invoice.body.publicUrl).pathname.split('/').pop()!);
    const page = await ctx.api().get(`/api/v1/public/banquets/invoices/${invoiceToken}`).expect(200);
    await sandboxPay(ctx, page.body.paymentUrl);
    await ctx.drain();
    expect((await ctx.api().get(`/api/v1/admin/banquets/requests/${request.id}`).set('Authorization', manager.auth).expect(200)).body.status).toBe('prepaid');

    await ctx.api().post(`/api/v1/admin/banquets/requests/${request.id}/transition`).set('Authorization', manager.auth).send({ to: 'cancelled', reason: 'Мероприятие отменено' }).expect(200);
    await ctx.drain();
    const hold = await ctx.api().get(`/api/v1/admin/reservations/${held.body.venue.reservationId}`).set('Authorization', await ctx.owner()).expect(200);
    expect(hold.body.status).toBe('cancelled');

    const [payment] = await paymentsOf(ctx, invoice.body.id);
    const refund = await ctx
      .api()
      .post(`/api/v1/admin/banquets/requests/${request.id}/refunds`)
      .set('Authorization', finance.auth)
      .send({ paymentId: payment.id, reason: 'Отмена мероприятия', idempotencyKey: idem('bq-refund') })
      .expect(201);
    expect(refund.body).toMatchObject({ amount: money(50_000), status: 'pending' });
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    const [refunded] = await paymentsOf(ctx, invoice.body.id);
    expect(refunded).toMatchObject({ status: 'refunded', refundedAmount: money(50_000) });
    const inv = await ctx.api().get(`/api/v1/admin/banquets/invoices/${invoice.body.id}`).set('Authorization', finance.auth).expect(200);
    expect(inv.body.refunded).toEqual(money(50_000));

    const revenue = await report(ctx, 'revenue', { from: '2026-10-01', to: '2026-10-12', branchId: greenline });
    expect(revenue.totals).toMatchObject({ banquet: money(0), refunds: money(0), total: money(0) });
    const cash = await report(ctx, 'payments', { from: '2026-10-01', to: '2026-10-01', branchId: greenline });
    expect(cash.totals).toMatchObject({ received: money(50_000), refunded: money(50_000), net: money(0) });
    const funnel = await report(ctx, 'banquet-funnel', { from: '2026-10-01', to: '2026-10-01', branchId: greenline });
    expect(funnel.cancelReasons).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'Мероприятие отменено', count: 1 })]));
  });

  it('operator reschedules a confirmed booking: the old reminder does not fire, the new one does; hall-load has no overbookings', async () => {
    const { greenline } = ctx.seed.branches;
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL');
    const free = await ctx.api().get('/api/v1/public/branches/greenline/reservation-availability').query({ date: '2026-10-02', time: '19:00', guests: 4, typeCode: 'table' }).expect(200);
    const booked = await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({ branchId: greenline, venueId: free.body.venues[0].venueId, date: '2026-10-02', time: '19:00', guests: 4, customer: { name: 'Гость', phone: '+77015550002' }, consent: { personalData: true }, locale: 'ru', idempotencyKey: idem('resv') })
      .expect(201);
    await ctx.drain();
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: booked.body.number }).set('Authorization', operator.auth).expect(200);
    const id = list.body.items[0].id;
    await ctx.api().post(`/api/v1/admin/reservations/${id}/reschedule`).set('Authorization', operator.auth).send({ date: '2026-10-02', time: '21:00', reason: 'Гость попросил позже' }).expect(200);
    await ctx.drain();

    ctx.t.clock.set(new Date('2026-10-02T11:05:00.000Z')); // 16:05 — старое напоминание (за 3 ч до 19:00) не должно уйти
    await ctx.drain();
    expect(await deliveries(ctx, { relatedId: id, template: 'reservation.reminder' })).toEqual([]);
    ctx.t.clock.set(new Date('2026-10-02T13:05:00.000Z')); // 18:05 — за 3 ч до 21:00
    await ctx.drain();
    expect((await deliveries(ctx, { relatedId: id, template: 'reservation.reminder' })).map((d) => d.status)).toEqual(['sent']);

    const load = await report(ctx, 'hall-load', { from: '2026-10-02', to: '2026-10-02', branchId: greenline });
    expect(load.overbookingCount).toBe(0);
    expect(load.rows.find((r: any) => r.venueTypeCode === 'table')).toMatchObject({ reservations: 1, guests: 4, bookedMinutes: 120 });
  });
});
