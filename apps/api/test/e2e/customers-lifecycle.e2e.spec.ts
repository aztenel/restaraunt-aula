import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createE2eApp, deliveries, E2E_TODAY, E2eContext, idem, pendingOutbox, sandboxPay } from './support/e2e-app';
import { adminOrder, advanceOrder, customerByPhone, placeOrder, report, storefrontMenu, tracking } from './support/ordering';

const PHONE = '+77074443322';

/**
 * Дополнительно: база гостей как проекция событий всех модулей — автотег «постоянный» (3 выполненных
 * заказа), неявка по брони, тег «банкетный», обезличивание по требованию гостя (CustomerAnonymized →
 * Ordering, Reservation, Banquet стирают снимки контактов), дневной отчёт собственнику (Reporting → Notifications).
 */
describe('E2E extra: customer lifecycle across modules', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  it('regular tag after 3 completed orders, no-show counter, banquet tag; anonymization propagates to orders, reservations and banquet requests', async () => {
    const { greenline } = ctx.seed.branches;
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL');
    const manager = await ctx.staff([{ role: 'banquet_manager' }], 'Банкетный менеджер (тест)');
    const owner = await ctx.staff([{ role: 'owner' }], 'Собственник (тест)', { phone: '+77010000888' });
    const menu = await storefrontMenu(ctx, 'greenline');

    // ---------------------------------------------------------------- 3 выполненных заказа → тег regular
    const orderIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const placed = await placeOrder(ctx, { branchId: greenline, type: 'pickup', items: [{ dishId: menu.get('kazy')!.id, quantity: 1 }], paymentMethod: 'online', phone: PHONE, name: 'Ержан' });
      await ctx.drain();
      await sandboxPay(ctx, (await tracking(ctx, placed.publicToken)).payment.current.paymentUrl);
      await ctx.drain();
      for (const to of ['accepted', 'cooking', 'ready', 'completed']) await advanceOrder(ctx, placed.orderId, operator.auth, to);
      await ctx.drain();
      orderIds.push(placed.orderId);
      const guest = await customerByPhone(ctx, PHONE);
      expect(guest.customer.tags.includes('regular'), `after order ${i + 1}`).toBe(i === 2);
    }

    // ---------------------------------------------------------------- Бронь стола без депозита → неявка
    const free = await ctx.api().get('/api/v1/public/branches/greenline/reservation-availability').query({ date: E2E_TODAY, time: '13:00', guests: 2, typeCode: 'table' }).expect(200);
    const booking = await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({ branchId: greenline, venueId: free.body.venues[0].venueId, date: E2E_TODAY, time: '13:00', guests: 2, customer: { name: 'Ержан', phone: PHONE }, consent: { personalData: true }, locale: 'ru', idempotencyKey: idem('resv') })
      .expect(201);
    expect(booking.body.status).toBe('confirmed');
    await ctx.drain();
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: booking.body.number }).set('Authorization', operator.auth).expect(200);
    const reservationId = list.body.items[0].id;
    // Отметить неявку можно только после начала.
    expect((await ctx.api().post(`/api/v1/admin/reservations/${reservationId}/no-show`).set('Authorization', operator.auth)).status).not.toBe(200);
    ctx.t.clock.set(new Date('2026-10-01T08:30:00.000Z')); // 13:30 по Астане
    await ctx.api().post(`/api/v1/admin/reservations/${reservationId}/no-show`).set('Authorization', operator.auth).expect(200);
    await ctx.drain();

    // ---------------------------------------------------------------- Банкетная заявка того же гостя
    const banquet = await ctx
      .api()
      .post('/api/v1/public/banquets/requests')
      .send({ eventDate: '2026-11-01', eventType: 'birthday', guests: 20, branchId: greenline, contact: { name: 'Ержан', phone: PHONE }, consent: { personalData: true }, locale: 'ru' })
      .expect(201);
    await ctx.drain();
    const banquetList = await ctx.api().get('/api/v1/admin/banquets/requests').query({ q: banquet.body.number }).set('Authorization', manager.auth).expect(200);
    const requestId = banquetList.body.items[0].id;

    let guest = await customerByPhone(ctx, PHONE);
    expect(guest.customer).toMatchObject({ completedOrdersCount: 3, reservationsCount: 1, noShowCount: 1, banquetsCount: 1 });
    expect(guest.customer.tags).toEqual(expect.arrayContaining(['regular', 'banquet']));
    expect(guest.totals).toMatchObject({ noShows: 1, banquetRequests: 1, ordersCompleted: 3 });

    // ---------------------------------------------------------------- Дневной отчёт собственнику (23:30)
    ctx.t.clock.set(new Date('2026-10-01T18:30:00.000Z'));
    await ctx.t.runSchedule('reporting.daily_report');
    await ctx.drain();
    const daily = await deliveries(ctx, { template: 'staff.daily_report' });
    expect(daily).toEqual(expect.arrayContaining([expect.objectContaining({ recipientName: 'Собственник (тест)', status: 'sent' })]));
    const dailyReport = await ctx.api().get('/api/v1/admin/reports/daily').query({ date: E2E_TODAY }).set('Authorization', owner.auth).expect(200);
    expect(JSON.stringify(dailyReport.body)).toContain('1470000'); // выручка 3 × 4 900 ₸

    // ---------------------------------------------------------------- Обезличивание по требованию гостя
    const anonymized = await ctx.api().post(`/api/v1/admin/customers/${guest.customer.id}/anonymize`).set('Authorization', owner.auth).send({ reason: 'Заявление гостя' }).expect(200);
    expect(anonymized.body).toMatchObject({ phone: null, name: null, anonymizedAt: expect.any(String), completedOrdersCount: 3 });
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);

    for (const orderId of orderIds) {
      const order = await adminOrder(ctx, orderId, operator.auth);
      expect(JSON.stringify(order.customer)).not.toContain(PHONE);
      expect(JSON.stringify(order)).not.toContain('Ержан');
      expect(order.total).toEqual({ amount: 490_000, currency: 'KZT' }); // суммы остаются для отчётов
    }
    const reservation = await ctx.api().get(`/api/v1/admin/reservations/${reservationId}`).set('Authorization', operator.auth).expect(200);
    expect(JSON.stringify(reservation.body.customer)).not.toContain(PHONE);
    expect(reservation.body.status).toBe('no_show');
    const request = await ctx.api().get(`/api/v1/admin/banquets/requests/${requestId}`).set('Authorization', manager.auth).expect(200);
    expect(JSON.stringify(request.body)).not.toContain(PHONE);
    // Отчёты не пострадали.
    const revenue = await report(ctx, 'revenue', { from: E2E_TODAY, to: E2E_TODAY, branchId: greenline });
    expect(revenue.totals.pickup).toEqual({ amount: 1_470_000, currency: 'KZT' });
    // Гостя больше нельзя найти по телефону.
    const search = await ctx.api().get('/api/v1/admin/customers').query({ q: PHONE.replace(/\D/g, '') }).set('Authorization', owner.auth).expect(200);
    expect(search.body.items).toEqual([]);
    guest = (await ctx.api().get(`/api/v1/admin/customers/${anonymized.body.id}`).set('Authorization', owner.auth).expect(200)).body;
    expect(guest.customer).toMatchObject({ phone: null, noShowCount: 1, banquetsCount: 1 });
  });
});
