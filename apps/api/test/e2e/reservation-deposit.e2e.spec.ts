import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, createE2eApp, deliveries, E2eContext, feed, idem, money, pendingOutbox, sandboxPay } from './support/e2e-app';
import { customerByPhone, paymentsOf, report } from './support/ordering';

const PHONE = '+77015556677';

/**
 * Сценарий 6: бронь VIP-зала с депозитом. Reservation (свободные места, бронь с блокировкой места) →
 * Payments (депозит онлайн, песочница) → Reservation (confirmed, напоминание задачей с runAt) →
 * отмена гостем после дедлайна (депозит удержан) и до дедлайна (возврат через провайдера) →
 * Notifications, Customers, Reporting.
 */
describe('E2E 6: reservation with deposit', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
  });

  async function availability(date: string, time: string, guests: number) {
    const res = await ctx
      .api()
      .get('/api/v1/public/branches/greenline/reservation-availability')
      .query({ date, time, guests, typeCode: 'vip_hall', locale: 'ru' })
      .expect(200);
    return res.body;
  }

  async function book(venueId: string, date: string, time: string, guests: number) {
    const res = await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({
        branchId: ctx.seed.branches.greenline,
        venueId,
        date,
        time,
        guests,
        customer: { name: 'Нурлан', phone: '8 701 555 66 77', email: 'nurlan@example.kz' },
        occasion: 'День рождения',
        consent: { personalData: true },
        locale: 'ru',
        idempotencyKey: idem('resv'),
      });
    if (res.status !== 201) throw new Error(`booking failed ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function publicReservation(token: string) {
    return (await ctx.api().get(`/api/v1/public/reservations/${token}`).query({ locale: 'ru' }).expect(200)).body;
  }

  async function adminReservationByNumber(number: string, auth: string) {
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: number, perPage: 50 }).set('Authorization', auth).expect(200);
    const summary = (list.body.items as any[]).find((r) => r.number === number);
    expect(summary, `reservation ${number} in admin list`).toBeTruthy();
    return (await ctx.api().get(`/api/v1/admin/reservations/${summary.id}`).set('Authorization', auth).expect(200)).body;
  }

  /** Бронь с депозитом → ссылка на оплату появляется задачей → оплата в песочнице → confirmed. */
  async function bookAndPay(venueId: string, date: string, time: string, guests: number) {
    const booked = await book(venueId, date, time, guests);
    expect(booked).toMatchObject({ status: 'awaiting_deposit', deposit: { amount: money(50_000), state: 'pending' }, canPay: true });
    await ctx.drain();
    const pending = await publicReservation(booked.token);
    expect(pending.deposit.paymentUrl).toContain('/public/payments/sandbox/');
    await sandboxPay(ctx, pending.deposit.paymentUrl);
    await ctx.drain();
    const confirmed = await publicReservation(booked.token);
    expect(confirmed).toMatchObject({ status: 'confirmed', deposit: { state: 'paid', paymentStatus: 'succeeded', outcome: 'none' } });
    return confirmed;
  }

  it('availability → VIP booking with deposit → paid → confirmed → reminder → late cancel retains; early cancel refunds', async () => {
    const { greenline } = ctx.seed.branches;
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL', { phone: '+77010000555' });

    // ---------------------------------------------------------------- Свободные VIP-залы на завтра 19:00, 8 гостей
    const free = await availability('2026-10-02', '19:00', 8);
    expect(free.available).toBe(true);
    const vip1 = free.venues.find((v: any) => v.name === 'VIP-зал «Алтын»');
    const vip2 = free.venues.find((v: any) => v.name === 'VIP-зал «Күміс»');
    expect(vip1).toMatchObject({ typeCode: 'vip_hall', capacityMin: 6, capacityMax: 12, deposit: money(50_000), rules: { cancellationDeadlineHours: 24, holdMinutes: 30 } });
    expect(vip2).toBeTruthy();

    // ---------------------------------------------------------------- Бронь A: завтра 19:00 (дедлайн отмены — сегодня 19:00)
    const a = await bookAndPay(vip1.venueId, '2026-10-02', '19:00', 8);
    expect(a).toMatchObject({ venue: { id: vip1.venueId, typeCode: 'vip_hall' }, guests: 8, occasion: 'День рождения', depositOutcomeIfCancelled: 'refunded' });
    // Место занято: его больше нет среди свободных, повторная бронь — 409.
    const after = await availability('2026-10-02', '19:00', 8);
    expect(after.venues.map((v: any) => v.venueId)).not.toContain(vip1.venueId);
    const clash = await ctx
      .api()
      .post('/api/v1/public/reservations')
      .send({
        branchId: greenline,
        venueId: vip1.venueId,
        date: '2026-10-02',
        time: '20:00',
        guests: 6,
        customer: { name: 'Другой гость', phone: '+77017778899' },
        consent: { personalData: true },
        locale: 'ru',
        idempotencyKey: idem('resv'),
      });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('reservation.venue_occupied');

    const aAdmin = await adminReservationByNumber(a.number, operator.auth);
    expect(aAdmin).toMatchObject({ status: 'confirmed', kind: 'regular', source: 'web', depositState: 'paid', customer: { phone: PHONE } });
    const [aPayment] = await paymentsOf(ctx, aAdmin.id);
    expect(aPayment).toMatchObject({ purpose: 'reservation_deposit', method: 'online', status: 'succeeded', amount: money(50_000), branchId: greenline });

    // Уведомления: гостю (ожидает депозит → подтверждена), персоналу — новая бронь; лента — со звуком.
    const aGuest = (await deliveries(ctx, { relatedId: aAdmin.id, audience: 'guest' })).map((d) => d.template).sort();
    expect(aGuest).toEqual(['reservation.awaiting_deposit', 'reservation.confirmed']);
    expect(await deliveries(ctx, { relatedId: aAdmin.id, template: 'staff.reservation_new' })).toEqual([
      expect.objectContaining({ recipientName: 'Оператор GL', status: 'sent' }),
    ]);
    expect((await feed(ctx)).some((f) => f.entityId === aAdmin.id && f.stream === 'reservations' && f.kind === 'created' && f.sound)).toBe(true);

    // ---------------------------------------------------------------- Бронь B: 5 октября — отмена до дедлайна
    const b = await bookAndPay(vip2.venueId, '2026-10-05', '19:00', 10);
    const cancelB = await ctx.api().post(`/api/v1/public/reservations/${b.token}/cancel`).send({ reason: 'Планы изменились' }).expect(200);
    expect(cancelB.body).toMatchObject({ status: 'cancelled', deposit: { outcome: 'refunded', state: 'refund_pending' } });
    await ctx.drain();
    const bDone = await publicReservation(b.token);
    expect(bDone.deposit).toMatchObject({ outcome: 'refunded', state: 'refunded' });
    const bAdmin = await adminReservationByNumber(b.number, operator.auth);
    const [bPayment] = await paymentsOf(ctx, bAdmin.id);
    expect(bPayment).toMatchObject({ status: 'refunded', refundedAmount: money(50_000) });
    expect((await deliveries(ctx, { relatedId: bAdmin.id, template: 'reservation.cancelled' })).map((d) => d.status)).toEqual(['sent']);
    // Зал B снова свободен.
    expect((await availability('2026-10-05', '19:00', 10)).venues.map((v: any) => v.venueId)).toContain(vip2.venueId);

    // ---------------------------------------------------------------- Напоминание за 3 часа (задача с runAt)
    expect(await deliveries(ctx, { relatedId: aAdmin.id, template: 'reservation.reminder' })).toEqual([]);
    ctx.t.clock.set(new Date('2026-10-02T10:59:00.000Z')); // 15:59 по Астане — рано
    await ctx.drain();
    expect(await deliveries(ctx, { relatedId: aAdmin.id, template: 'reservation.reminder' })).toEqual([]);
    ctx.t.clock.set(new Date('2026-10-02T11:01:00.000Z')); // 16:01 — за 3 часа до 19:00
    await ctx.drain();
    expect(await deliveries(ctx, { relatedId: aAdmin.id, template: 'reservation.reminder' })).toEqual([
      expect.objectContaining({ status: 'sent', audience: 'guest', channel: 'whatsapp' }),
    ]);
    expect((await adminReservationByNumber(a.number, operator.auth)).reminderSentAt).toBeTruthy();

    // ---------------------------------------------------------------- Отмена A после дедлайна: депозит удержан
    const lateView = await publicReservation(a.token);
    expect(lateView).toMatchObject({ canCancel: true, depositOutcomeIfCancelled: 'retained' });
    const cancelA = await ctx.api().post(`/api/v1/public/reservations/${a.token}/cancel`).send({}).expect(200);
    expect(cancelA.body).toMatchObject({ status: 'cancelled', deposit: { outcome: 'retained', state: 'retained' } });
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
    const [aPaymentAfter] = await paymentsOf(ctx, aAdmin.id);
    expect(aPaymentAfter).toMatchObject({ status: 'succeeded', refundedAmount: money(0) });
    const aAudit = await auditLog(ctx, { entityId: aAdmin.id });
    expect(aAudit.map((x) => x.action)).toEqual([
      'reservation.created',
      'reservation.deposit_paid',
      'reservation.status_changed',
      'reservation.status_changed',
      'reservation.deposit_retained',
    ]);
    expect(aAudit.filter((x) => x.action === 'reservation.status_changed').map((x) => `${x.before.status}>${x.after.status}`)).toEqual([
      'awaiting_deposit>confirmed',
      'confirmed>cancelled',
    ]);
    expect((await deliveries(ctx, { relatedId: aAdmin.id, template: 'staff.reservation_cancelled' })).length).toBe(1);

    // ---------------------------------------------------------------- Гость и отчёты
    const guest = await customerByPhone(ctx, PHONE);
    expect(guest.customer).toMatchObject({ name: 'Нурлан', reservationsCount: 2 });
    expect(guest.activities.items.filter((x: any) => x.type === 'reservation_cancelled')).toHaveLength(2);
    const cash = await report(ctx, 'payments', { from: '2026-10-01', to: '2026-10-02', branchId: greenline });
    expect(cash.purposes).toEqual(
      expect.arrayContaining([expect.objectContaining({ purpose: 'reservation_deposit', received: money(100_000), refunded: money(50_000), net: money(50_000) })]),
    );
    // Депозит — не выручка каналов.
    const revenue = await report(ctx, 'revenue', { from: '2026-10-01', to: '2026-10-02', branchId: greenline });
    expect(revenue.totals.total).toEqual(money(0));
  });

  it('manual-confirmation yurt: a paid deposit puts the booking into the attention queue; admin availability ignores web limits', async () => {
    const { greenline } = ctx.seed.branches;
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }], 'Оператор GL', { phone: '+77010000556' });
    const free = await ctx
      .api()
      .get('/api/v1/public/branches/greenline/reservation-availability')
      .query({ date: '2026-10-05', time: '18:00', guests: 15, typeCode: 'yurt', locale: 'ru' })
      .expect(200);
    const yurtId = free.body.venues[0].venueId as string;
    const booked = await book(yurtId, '2026-10-05', '18:00', 15);
    expect(booked.status).toBe('awaiting_deposit');
    await ctx.drain();
    await sandboxPay(ctx, (await publicReservation(booked.token)).deposit.paymentUrl);
    await ctx.drain();
    expect(await publicReservation(booked.token)).toMatchObject({ status: 'pending', deposit: { state: 'paid' } });

    // Депозит оплачен, но нужен сотрудник: в ленте — «новое» со звуком и ссылкой на бронь.
    const admin = await adminReservationByNumber(booked.number, operator.auth);
    expect(admin.allowedTransitions).toEqual(expect.arrayContaining(['confirmed', 'cancelled']));
    const items = (await feed(ctx, operator.auth)).filter((f) => f.entityId === admin.id);
    expect(items.at(-1)).toMatchObject({ stream: 'reservations', kind: 'created', sound: true, entityType: 'reservation' });
    expect(items.at(-1)!.title).toContain('ждёт подтверждения');
    // Список и календарь: действия, срок удержания и правила места.
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: booked.number }).set('Authorization', operator.auth).expect(200);
    expect(list.body.items[0]).toMatchObject({ allowedTransitions: admin.allowedTransitions, canReschedule: admin.canReschedule, holdExpiresAt: admin.holdExpiresAt });
    const timeline = await ctx.api().get('/api/v1/admin/reservations/timeline').query({ branchId: greenline, date: '2026-10-05' }).set('Authorization', operator.auth).expect(200);
    const yurt = timeline.body.halls.flatMap((h: { venues: any[] }) => h.venues).find((v: { id: string }) => v.id === yurtId);
    expect(yurt.rules).toMatchObject({ requiresManualConfirmation: true, durationMinutes: expect.any(Number), cleanupMinutes: expect.any(Number) });
    expect(yurt.items).toEqual([expect.objectContaining({ status: 'pending', holdExpiresAt: admin.holdExpiresAt })]);

    // Оператор бронирует через 30 минут (витрине рано) и видит занятую юрту занятой.
    const web = await ctx.api().get('/api/v1/public/branches/greenline/reservation-availability').query({ date: '2026-10-01', time: '11:30', guests: 2 }).expect(200);
    expect(web.body).toMatchObject({ available: false, reason: 'too_soon' });
    const staffSlots = await ctx
      .api()
      .get('/api/v1/admin/reservations/availability')
      .query({ branchId: greenline, date: '2026-10-01', time: '11:30', guests: 2 })
      .set('Authorization', operator.auth)
      .expect(200);
    expect(staffSlots.body).toMatchObject({ available: true, reason: null });
    const busy = await ctx
      .api()
      .get('/api/v1/admin/reservations/availability')
      .query({ branchId: greenline, date: '2026-10-05', time: '18:00', guests: 15, typeCode: 'yurt' })
      .set('Authorization', operator.auth)
      .expect(200);
    expect(busy.body).toMatchObject({ available: false, reason: 'occupied' });
    await ctx
      .api()
      .post(`/api/v1/admin/reservations/${admin.id}/confirm`)
      .set('Authorization', operator.auth)
      .send({})
      .expect(200);
    expect((await adminReservationByNumber(booked.number, operator.auth)).status).toBe('confirmed');
  });

  it('unpaid deposit hold expires after holdMinutes and the payment is cancelled', async () => {
    const free = await availability('2026-10-03', '18:00', 8);
    const vip1 = free.venues.find((v: any) => v.name === 'VIP-зал «Алтын»');
    const booked = await book(vip1.venueId, '2026-10-03', '18:00', 8);
    await ctx.drain();
    ctx.t.clock.advance(31 * 60_000);
    await ctx.t.runSchedule('reservation.expire_holds');
    await ctx.drain();
    const view = await publicReservation(booked.token);
    expect(view).toMatchObject({ status: 'expired', deposit: { state: 'unpaid' }, canPay: false });
    const owner = await ctx.owner();
    const list = await ctx.api().get('/api/v1/admin/reservations').query({ q: booked.number }).set('Authorization', owner).expect(200);
    const [payment] = await paymentsOf(ctx, list.body.items[0].id);
    expect(payment.status).toBe('cancelled');
    expect((await deliveries(ctx, { relatedId: list.body.items[0].id, template: 'reservation.expired' })).length).toBe(1);
    // Место снова свободно.
    expect((await availability('2026-10-03', '18:00', 8)).venues.map((v: any) => v.venueId)).toContain(vip1.venueId);
  });
});
