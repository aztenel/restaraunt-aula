import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createE2eApp, E2eContext, outboxEvents } from './support/e2e-app';
import { adminBanquetRequest, guestBooking, holdVenue, vipVenues } from './support/banquet';
import { report } from './support/ordering';

/**
 * Сценарий 7: зал не может быть одновременно занят банкетом и обычной бронью — с НАСТОЯЩИМИ модулями
 * Banquet (SetBanquetVenue → VenueAvailability.holdForBanquet) и Reservation (BookReservation).
 * Обе стороны проходят через одну блокировку места и exclusion constraint.
 */
describe('E2E 7: banquet ↔ reservation venue conflicts', () => {
  let ctx: E2eContext;
  let manager: { userId: string; auth: string };

  beforeAll(async () => {
    ctx = await createE2eApp();
  });
  afterAll(async () => ctx?.close());
  beforeEach(async () => {
    await ctx.reset();
    manager = await ctx.staff([{ role: 'banquet_manager' }], 'Банкетный менеджер (тест)');
  });

  it('a banquet hold blocks guest booking of the same hall/time (409) and shows up as banquet occupancy', async () => {
    const { greenline } = ctx.seed.branches;
    const { vip1, vip2 } = await vipVenues(ctx);
    const request = await adminBanquetRequest(ctx, manager.auth, { eventDate: '2026-10-10', guests: 10, branchId: greenline });
    const held = await holdVenue(ctx, manager.auth, request.id, vip1, '2026-10-10').expect(200);
    expect(held.body.venue).toMatchObject({ venueId: vip1, reservationId: expect.any(String) });
    const holdId = held.body.venue.reservationId;

    // Гость пытается забронировать тот же зал в пересекающееся время.
    const clash = await guestBooking(ctx, vip1, '2026-10-10', '19:00');
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('reservation.venue_occupied');
    // Витрина не предлагает занятый зал; соседний свободен.
    const free = await ctx
      .api()
      .get('/api/v1/public/branches/greenline/reservation-availability')
      .query({ date: '2026-10-10', time: '19:00', guests: 8, typeCode: 'vip_hall' })
      .expect(200);
    expect(free.body.venues.map((v: any) => v.venueId)).toEqual([vip2]);
    // До банкета зал свободен: 14:00–17:00 + уборка 30 мин не пересекается с 18:00; 15:00 — уже пересекается.
    const early = await guestBooking(ctx, vip1, '2026-10-10', '15:00', 6);
    expect(early.status).toBe(409);
    await guestBooking(ctx, vip1, '2026-10-10', '14:00', 6).expect(201);

    // Занятость видна в календаре брони как банкет (модуль Reservation), и в календаре банкетов (Banquet).
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }]);
    const timeline = await ctx.api().get('/api/v1/admin/reservations/timeline').query({ branchId: greenline, date: '2026-10-10' }).set('Authorization', operator.auth).expect(200);
    const items = JSON.stringify(timeline.body);
    expect(items).toContain(holdId);
    expect(items).toContain(request.id);
    const hold = await ctx.api().get(`/api/v1/admin/reservations/${holdId}`).set('Authorization', operator.auth).expect(200);
    expect(hold.body).toMatchObject({ kind: 'banquet', status: 'confirmed', source: 'banquet', banquetRequestId: request.id, guests: 10 });
    const calendar = await ctx.api().get('/api/v1/admin/banquets/calendar').query({ branchId: greenline, from: '2026-10-10', to: '2026-10-10' }).set('Authorization', manager.auth).expect(200);
    expect(calendar.body.occupancy).toEqual(expect.arrayContaining([expect.objectContaining({ reservationId: holdId, kind: 'banquet', banquetRequestId: request.id })]));
    const created = (await outboxEvents(ctx, 'reservation.reservation_created')).filter((e) => e.payload.reservationId === holdId);
    expect(created.map((e) => [e.payload.kind, e.payload.source, e.payload.banquetRequestId])).toEqual([['banquet', 'banquet', request.id]]);

    // Отмена банкета освобождает зал.
    await ctx.api().post(`/api/v1/admin/banquets/requests/${request.id}/transition`).set('Authorization', manager.auth).send({ to: 'cancelled', reason: 'Клиент передумал' }).expect(200);
    await ctx.drain();
    const released = await ctx.api().get(`/api/v1/admin/reservations/${holdId}`).set('Authorization', operator.auth).expect(200);
    expect(released.body.status).toBe('cancelled');
    await guestBooking(ctx, vip1, '2026-10-10', '19:00').expect(201);
  });

  it('a guest booking (even awaiting deposit) blocks a banquet hold of the same hall/time (409), also when moving a hold', async () => {
    const { greenline } = ctx.seed.branches;
    const { vip1, vip2 } = await vipVenues(ctx, '2026-10-11');
    const booking = await guestBooking(ctx, vip2, '2026-10-11', '19:00').expect(201);
    expect(booking.body.status).toBe('awaiting_deposit');

    const request = await adminBanquetRequest(ctx, manager.auth, { eventDate: '2026-10-11', guests: 10, branchId: greenline });
    const clash = await holdVenue(ctx, manager.auth, request.id, vip2, '2026-10-11');
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('reservation.venue_occupied');
    const detail = await ctx.api().get(`/api/v1/admin/banquets/requests/${request.id}`).set('Authorization', manager.auth).expect(200);
    expect(detail.body.venue).toBeNull();

    // Другой зал свободен; перенос занятости на занятый зал — тоже 409, занятость остаётся прежней.
    const held = await holdVenue(ctx, manager.auth, request.id, vip1, '2026-10-11').expect(200);
    const move = await holdVenue(ctx, manager.auth, request.id, vip2, '2026-10-11');
    expect(move.status).toBe(409);
    const after = await ctx.api().get(`/api/v1/admin/banquets/requests/${request.id}`).set('Authorization', manager.auth).expect(200);
    expect(after.body.venue).toMatchObject({ venueId: vip1, reservationId: held.body.venue.reservationId });
  });

  it('concurrent guest booking and banquet hold of the same hall: exactly one wins', async () => {
    const { greenline } = ctx.seed.branches;
    const { vip1 } = await vipVenues(ctx, '2026-10-12');
    const dates = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'];
    const requests = [];
    for (const date of dates) requests.push(await adminBanquetRequest(ctx, manager.auth, { eventDate: date, guests: 10, branchId: greenline }));

    for (const [i, date] of dates.entries()) {
      const [guest, banquet] = await Promise.all([
        guestBooking(ctx, vip1, date, '19:00', 8, `+7701999000${i}`),
        holdVenue(ctx, manager.auth, requests[i].id, vip1, date, '18:00', '23:00'),
      ]);
      const statuses = [guest.status, banquet.status].sort();
      expect(statuses, `${date}: guest ${guest.status} ${JSON.stringify(guest.body.error ?? '')}, banquet ${banquet.status} ${JSON.stringify(banquet.body.error ?? '')}`).toEqual(
        guest.status === 201 ? [201, 409] : [200, 409],
      );
      const loser = guest.status === 409 ? guest : banquet;
      expect(loser.body.error.code).toBe('reservation.venue_occupied');
    }

    // В базе на каждую дату — ровно одна занимающая место запись.
    const operator = await ctx.staff([{ role: 'branch_operator', branchId: greenline }]);
    for (const date of dates) {
      const list = await ctx.api().get('/api/v1/admin/reservations').query({ branchId: greenline, dateFrom: date, dateTo: date, venueId: vip1 }).set('Authorization', operator.auth).expect(200);
      const blocking = (list.body.items as any[]).filter((r) => ['pending', 'awaiting_deposit', 'confirmed', 'arrived'].includes(r.status));
      expect(blocking, date).toHaveLength(1);
    }
    // Проекция Reporting (загрузка залов) тоже не видит накладок — цель ТЗ «0 накладок в месяц».
    await ctx.drain();
    const load = await report(ctx, 'hall-load', { from: dates[0], to: dates[dates.length - 1], branchId: greenline });
    expect(load.overbookingCount).toBe(0);
    const vipRows = load.rows.filter((r: any) => r.venueTypeCode === 'vip_hall');
    expect(vipRows.reduce((sum: number, r: any) => sum + r.reservations, 0)).toBe(dates.length);
  });
});
