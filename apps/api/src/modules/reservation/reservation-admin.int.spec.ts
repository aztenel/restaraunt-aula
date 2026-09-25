import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { tokenFor } from '../../../test/support/fixtures';
import { TestApp } from '../../../test/support/test-app';
import { newId } from '../../shared/kernel/ids';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { ReservationEvents, VenueAvailability } from './public';
import {
  auditActions,
  book,
  bookingBody,
  createLayout,
  createReservationTestApp,
  createVenue,
  minutes,
  outboxEvents,
  payDeposit,
  resetFakes,
  VenueLayout,
} from './testing/reservation-test-kit';

const ADMIN = '/api/v1/admin/reservations';
const local = (date: string, time: string) => zonedTimeToUtc(date, time, 'Asia/Almaty');

describe('Reservation: admin (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let a: VenueLayout;
  let b: VenueLayout;
  let owner: string;
  let operatorA: string;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    t.clock.set(local('2026-10-01', '11:00'));
    a = await createLayout(t);
    b = await createLayout(t, { types: a.types });
    ({ auth: owner } = await tokenFor(t, [{ role: 'owner' }]));
    ({ auth: operatorA } = await tokenFor(t, [{ role: 'branch_operator', branchId: a.branchId }]));
  });

  const staffBody = (layout: VenueLayout, overrides: Record<string, unknown> = {}) => ({
    branchId: layout.branchId,
    venueId: layout.table4,
    date: '2026-10-02',
    time: '19:00',
    guests: 3,
    customer: { name: 'Сергей', phone: '87015550011' },
    ...overrides,
  });

  async function create(body: Record<string, unknown>, auth = operatorA, status = 201) {
    const res = await t.http().post(ADMIN).set('authorization', auth).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(status);
    return res.body;
  }

  const post = (path: string, body: Record<string, unknown> = {}, auth = operatorA) => t.http().post(`${ADMIN}/${path}`).set('authorization', auth).send(body);
  const get = (path: string, auth = operatorA) => t.http().get(`${ADMIN}${path}`).set('authorization', auth);

  it('permissions: 401 without token, 403 without reservations permission, branch scoping', async () => {
    const r = await create(staffBody(b), owner);
    expect((await t.http().get(ADMIN)).status).toBe(401);
    const { auth: content } = await tokenFor(t, [{ role: 'content_manager' }]);
    expect((await get('', content)).status).toBe(403);

    const forbidden = await get(`?branchId=${b.branchId}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('access.forbidden_branch');
    expect((await get('')).body.total).toBe(0); // оператор филиала A не видит брони B
    expect((await get(`/${r.id}`)).status).toBe(403);
    expect((await post(`${r.id}/cancel`, { reason: 'x' })).status).toBe(403);
    expect((await create(staffBody(b), operatorA, 403)).error.code).toBe('access.forbidden');

    // Банкетный менеджер видит брони всех филиалов, но не ведёт их.
    const { auth: banquet } = await tokenFor(t, [{ role: 'banquet_manager' }]);
    expect((await get('', banquet)).body.total).toBe(1);
    expect((await t.http().post(ADMIN).set('authorization', banquet).send(staffBody(a))).status).toBe(403);
    expect((await get(`/${newId()}`, owner)).status).toBe(404);
    expect((await get('/not-a-uuid', owner)).status).toBe(400);
  });

  it('phone booking by an operator: non-online venue, confirmed immediately, consent by phone, no staff alert', async () => {
    const res = await create(
      staffBody(a, {
        venueId: a.phoneOnly,
        guests: 4,
        note: 'Постоянный гость',
        occasion: 'Юбилей',
        locale: 'kk',
        consent: { personalData: true },
        idempotencyKey: 'phone-booking-1',
      }),
    );
    expect(res).toMatchObject({
      status: 'confirmed',
      source: 'admin',
      kind: 'regular',
      guests: 4,
      note: 'Постоянный гость',
      occasion: 'Юбилей',
      customer: { name: 'Сергей', phone: '+77015550011' },
      depositState: 'none',
      allowedTransitions: ['cancelled'],
      canReschedule: true,
      date: '2026-10-02',
      time: '19:00',
    });
    expect(res.manageUrl).toContain('/kk/booking/');
    expect(res.history).toEqual([expect.objectContaining({ from: null, to: 'confirmed', actorKind: 'staff' })]);
    expect(fakes.customers.consents).toEqual([expect.objectContaining({ kind: 'personal_data', granted: true })]);
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.confirmed']);
    expect(fakes.notifier.guest[0]!.locale).toBe('kk');
    expect(fakes.notifier.staff).toHaveLength(0);
    expect(fakes.adminFeed.events[0]).toMatchObject({ kind: 'created', sound: false });

    // Идемпотентность брони по телефону.
    const again = await create(staffBody(a, { venueId: a.phoneOnly, guests: 4, idempotencyKey: 'phone-booking-1' }));
    expect(again.id).toBe(res.id);

    // Минимальная вместимость для оператора не проверяется, максимальная — да; часы работы — да.
    await create(staffBody(a, { venueId: a.vip, guests: 3, deposit: { mode: 'waive', waiveReason: 'Свой гость' } }));
    expect((await create(staffBody(a, { guests: 5, time: '12:00' }), operatorA, 422)).error.code).toBe('reservation.capacity_exceeded');
    expect((await create(staffBody(a, { time: '23:30' }), operatorA, 422)).error.code).toBe('reservation.slot_closed');
    // «Живая» посадка: начало до 15 минут назад допустимо.
    await create(staffBody(a, { date: '2026-10-01', time: '10:50', venueId: a.table6, guests: 4 }));
    expect((await create(staffBody(a, { date: '2026-10-01', time: '10:40' }), operatorA, 422)).error.code).toBe('reservation.slot_past');
  });

  it('deposit on phone booking: decision required; waive needs a reason (audited); payment link -> awaiting_deposit', async () => {
    const vip = staffBody(a, { venueId: a.vip, guests: 8 });
    expect((await create(vip, operatorA, 422)).error.code).toBe('reservation.deposit_decision_required');
    expect((await create({ ...vip, deposit: { mode: 'waive' } }, operatorA, 422)).error.code).toBe('reservation.deposit_waive_reason_required');

    const waived = await create({ ...vip, deposit: { mode: 'waive', waiveReason: 'Корпоративный клиент, оплата по счёту' } });
    expect(waived).toMatchObject({ status: 'confirmed', depositState: 'waived', depositWaiveReason: 'Корпоративный клиент, оплата по счёту' });
    const [created] = await outboxEvents(t, ReservationEvents.ReservationCreated);
    expect(created!.payload.deposit).toBeNull();
    const audit = await auditActions(t, waived.id);
    expect(audit.map((x) => x.action)).toEqual(['reservation.created', 'reservation.deposit_waived']);
    expect(audit[1]!.meta).toMatchObject({ reason: 'Корпоративный клиент, оплата по счёту' });
    expect(audit[1]!.actor_kind).toBe('staff');

    const link = await create({ ...vip, date: '2026-10-04', deposit: { mode: 'payment_link' } });
    expect(link).toMatchObject({ status: 'awaiting_deposit', depositState: 'pending', depositPayment: { status: 'created' } });
    expect(fakes.notifier.guest.map((g) => g.template)).toContain('reservation.awaiting_deposit');
    // Оплата по ссылке — сразу confirmed (ручное подтверждение уже сделал оператор).
    await payDeposit(t, fakes, link.depositPayment.id);
    expect((await get(`/${link.id}`)).body).toMatchObject({ status: 'confirmed', depositState: 'paid' });
  });

  it('confirm: pending -> confirmed (reminder scheduled); unpaid deposit only with a waiver reason', async () => {
    const manual = await createVenue(t, {
      hallId: a.hallId,
      typeId: a.types.table!,
      code: 'T30',
      capacityMin: 1,
      capacityMax: 6,
      rules: { requiresManualConfirmation: true },
      position: { x: 0, y: 450 },
    });
    const pending = await book(t, bookingBody(a, { venueId: manual }));
    const id = (await get(`?q=${pending.number}`)).body.items[0].id;
    expect((await get(`/${id}`)).body.allowedTransitions).toEqual(['confirmed', 'cancelled']);
    fakes.notifier.clear();
    const confirmed = await post(`${id}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body).toMatchObject({ status: 'confirmed', holdExpiresAt: null });
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.confirmed']);
    const jobs = await sql<{ n: number }>`select count(*)::int as n from platform.outbox where topic = 'reservation.send_reminder'`.execute(
      t.database.rootConnection(),
    );
    expect(jobs.rows[0]!.n).toBe(1);
    const again = await post(`${id}/confirm`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('reservation.invalid_transition');

    const awaiting = await create(staffBody(a, { venueId: a.vip, guests: 8, deposit: { mode: 'payment_link' } }));
    expect((await post(`${awaiting.id}/confirm`)).body.error.code).toBe('reservation.deposit_waive_reason_required');
    const waived = await post(`${awaiting.id}/confirm`, { waiveDepositReason: 'Гость оплатит на месте' });
    expect(waived.body).toMatchObject({ status: 'confirmed', depositState: 'waived', depositWaiveReason: 'Гость оплатит на месте' });
    expect(fakes.payments.payments.get(awaiting.depositPayment.id)!.status).toBe('cancelled');
    expect((await auditActions(t, awaiting.id)).map((x) => x.action)).toContain('reservation.deposit_waived');
  });

  it('staff cancel: reason required; deposit decision overrides the policy and is audited', async () => {
    const r = await create(staffBody(a, { venueId: a.vip, guests: 8, date: '2026-10-05', deposit: { mode: 'payment_link' } }));
    await payDeposit(t, fakes, r.depositPayment.id);
    expect((await get(`/${r.id}`)).body.depositOutcomeIfCancelled).toBe('refunded');

    expect((await post(`${r.id}/cancel`, {})).status).toBe(400);
    expect((await post(`${r.id}/cancel`, { reason: '   ' })).body.error.code).toBe('reservation.cancel_reason_required');
    expect((await post(`${r.id}/cancel`, { reason: 'x', depositDecision: 'keep' })).status).toBe(400);

    const cancelled = await post(`${r.id}/cancel`, { reason: 'Гость не отвечает', depositDecision: 'retain' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledBy: 'staff', depositState: 'retained', depositOutcome: 'retained' });
    expect(fakes.payments.refunds).toHaveLength(0);
    const audit = await auditActions(t, r.id);
    const decision = audit.find((x) => x.action === 'reservation.deposit_retained')!;
    expect(decision.meta).toMatchObject({ policyOutcome: 'refunded', overriddenByStaff: true });
    const changed = audit.filter((x) => x.action === 'reservation.status_changed').pop()!;
    expect(changed.before.status).toBe('confirmed');
    expect(changed.after.status).toBe('cancelled');
    expect(changed.meta).toMatchObject({ depositDecision: 'retain', overridden: true, reason: 'Гость не отвечает' });

    // Поздняя отмена с решением вернуть депозит.
    const late = await create(staffBody(a, { venueId: a.vip, guests: 8, date: '2026-10-01', time: '20:00', deposit: { mode: 'payment_link' } }));
    await payDeposit(t, fakes, late.depositPayment.id);
    const refund = await post(`${late.id}/cancel`, { reason: 'Закрыли зал на спецобслуживание', depositDecision: 'refund' });
    expect(refund.body).toMatchObject({ depositState: 'refund_pending', depositOutcome: 'refunded' });
    expect(fakes.payments.refunds.map((x) => x.paymentId)).toEqual([late.depositPayment.id]);
  });

  it('arrived / no_show: no_show only after the start; deposit applied or retained; needs-mark queue', async () => {
    const vip = await create(staffBody(a, { venueId: a.vip, guests: 8, deposit: { mode: 'payment_link' } }));
    await payDeposit(t, fakes, vip.depositPayment.id);
    const table = await create(staffBody(a));

    const early = await post(`${table.id}/no-show`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('reservation.no_show_before_start');
    expect((await post(`${table.id}/arrived`)).body.error.code).toBe('reservation.arrival_too_early');

    t.clock.set(local('2026-10-02', '19:20'));
    expect((await get('?needsMark=true')).body.items.map((x: { id: string }) => x.id).sort()).toEqual([table.id, vip.id].sort());
    expect((await get(`/${table.id}`)).body.allowedTransitions).toEqual(['arrived', 'no_show', 'cancelled']);

    const noShow = await post(`${vip.id}/no-show`);
    expect(noShow.body).toMatchObject({ status: 'no_show', depositState: 'retained', depositOutcome: 'retained', needsMark: false });
    const arrived = await post(`${table.id}/arrived`);
    expect(arrived.body).toMatchObject({ status: 'arrived', allowedTransitions: [] });
    expect((await get('?needsMark=true')).body.total).toBe(0);
    const events = (await outboxEvents(t, ReservationEvents.ReservationStatusChanged)).map((e) => `${e.payload.from}->${e.payload.to}`);
    expect(events).toEqual(expect.arrayContaining(['confirmed->no_show', 'confirmed->arrived']));
    // Неявка освобождает место: можно пересадить других гостей на это время.
    await create(staffBody(a, { venueId: a.vip, guests: 6, date: '2026-10-02', time: '19:30', deposit: { mode: 'waive', waiveReason: 'walk-in' } }));
  });

  it('reschedule / move: same locking and overlap rules; event with both slots; reminder follows the new time', async () => {
    const r = await create(staffBody(a));
    const blocker = await create(staffBody(a, { venueId: a.table6, guests: 5, time: '19:30', customer: { name: 'Б', phone: '+77019990000' } }));

    const occupied = await post(`${r.id}/reschedule`, { venueId: a.table6, guests: 5 });
    expect(occupied.status).toBe(409);
    expect(occupied.body.error.code).toBe('reservation.venue_occupied');
    expect((await post(`${r.id}/reschedule`, {})).body.error.code).toBe('reservation.nothing_to_change');
    expect((await post(`${r.id}/reschedule`, { venueId: b.table4 })).body.error.code).toBe('reservation.venue_other_branch');
    expect((await post(`${r.id}/reschedule`, { guests: 9 })).body.error.code).toBe('reservation.capacity_exceeded');
    expect((await post(`${r.id}/reschedule`, { time: '23:00' })).body.error.code).toBe('reservation.slot_closed');

    const moved = await post(`${r.id}/reschedule`, { venueId: a.table6, date: '2026-10-03', time: '20:00', guests: 6, reason: 'Гость попросил' });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ status: 'confirmed', date: '2026-10-03', time: '20:00', guests: 6, venue: { id: a.table6 } });
    const [event] = await outboxEvents(t, ReservationEvents.ReservationRescheduled);
    expect(event!.payload).toMatchObject({
      reservationId: r.id,
      status: 'confirmed',
      kind: 'regular',
      from: { venueId: a.table4, venueTypeCode: 'table', start: '2026-10-02T14:00:00.000Z', guests: 3 },
      to: { venueId: a.table6, start: '2026-10-03T15:00:00.000Z', end: '2026-10-03T17:00:00.000Z', guests: 6 },
      reason: 'Гость попросил',
    });
    expect((await auditActions(t, r.id)).map((x) => x.action)).toContain('reservation.rescheduled');
    // Прежнее место освободилось.
    await book(t, bookingBody(a));

    // Напоминание по старому времени не уходит, по новому — уходит.
    fakes.notifier.clear();
    t.clock.set(local('2026-10-02', '16:00'));
    await t.drain();
    expect(fakes.notifier.guest.filter((g) => g.template === 'reservation.reminder')).toHaveLength(1); // только бронь с витрины
    t.clock.set(local('2026-10-03', '17:00'));
    await t.drain();
    const reminders = fakes.notifier.guest.filter((g) => g.template === 'reservation.reminder');
    expect(reminders.map((g) => (g.params as { time: string }).time)).toEqual(['19:00', '20:00']);

    await post(`${blocker.id}/cancel`, { reason: 'x' });
    expect((await post(`${blocker.id}/reschedule`, { time: '21:00' })).body.error.code).toBe('reservation.cannot_reschedule');
  });

  it('list: filters by date, status, source, venue, search by number / phone / name; pagination', async () => {
    const web = await book(t, bookingBody(a));
    const phone = await create(staffBody(a, { venueId: a.table6, guests: 4, date: '2026-10-03', customer: { name: 'Ерлан Сейтов', phone: '+77077654321' } }));
    await create(staffBody(a, { venueId: a.vip, guests: 8, date: '2026-10-04', deposit: { mode: 'payment_link' } }));

    const all = await get('');
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((x: { date: string }) => x.date)).toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
    expect((await get('?dateFrom=2026-10-03&dateTo=2026-10-03')).body.items.map((x: { id: string }) => x.id)).toEqual([phone.id]);
    expect((await get('?status=awaiting_deposit')).body.total).toBe(1);
    expect((await get('?status=confirmed,awaiting_deposit')).body.total).toBe(3);
    expect((await get('?status=bogus')).status).toBe(400);
    expect((await get('?source=web')).body.items[0].number).toBe(web.number);
    expect((await get(`?venueId=${a.table6}`)).body.total).toBe(1);
    expect((await get(`?hallId=${a.hallId}`)).body.total).toBe(3);
    expect((await get('?q=765 43')).body.items.map((x: { id: string }) => x.id)).toEqual([phone.id]);
    expect((await get('?q=сейтов')).body.total).toBe(1);
    expect((await get(`?q=${web.number}`)).body.total).toBe(1);
    expect((await get('?perPage=2&page=2')).body).toMatchObject({ total: 3, page: 2, perPage: 2 });
    expect((await get('?perPage=2&page=2')).body.items).toHaveLength(1);
    expect((await get('?kind=banquet')).body.total).toBe(0);
    // Кнопки действий в списке — как в карточке.
    const byId = new Map(all.body.items.map((x: { id: string }) => [x.id, x]));
    expect(byId.get(phone.id)).toMatchObject({ allowedTransitions: ['cancelled'], canReschedule: true });
    const awaiting = all.body.items.find((x: { status: string }) => x.status === 'awaiting_deposit');
    expect(awaiting).toMatchObject({ canReschedule: true, holdExpiresAt: expect.any(String) });
    expect(awaiting.allowedTransitions).toEqual((await get(`/${awaiting.id}`)).body.allowedTransitions);
  });

  it('admin availability: phone-only venues, no web lead time / horizon, opening hours and overlaps respected', async () => {
    const q = (query: string, auth = operatorA) => get(`/availability?branchId=${a.branchId}&${query}`, auth);
    const venueIds = (body: { venues: Array<{ venueId: string }> }) => body.venues.map((v) => v.venueId);

    // Через 30 минут: витрине рано (lead 60 минут), оператору — можно; место «только по телефону» тоже в списке.
    const soon = await q('date=2026-10-01&time=11:30&guests=3');
    expect(soon.status).toBe(200);
    expect(soon.body).toMatchObject({ branchId: a.branchId, date: '2026-10-01', time: '11:30', guests: 3, available: true, reason: null });
    expect(venueIds(soon.body)).toEqual(expect.arrayContaining([a.table4, a.phoneOnly, a.table6]));
    const phoneOnly = soon.body.venues.find((v: { venueId: string }) => v.venueId === a.phoneOnly);
    expect(phoneOnly).toMatchObject({
      bookableOnline: false,
      belowMinimum: false,
      code: 'T9',
      hallId: a.hallId,
      rules: { bookableOnline: false, durationMinutes: expect.any(Number), cleanupMinutes: expect.any(Number) },
    });
    expect(soon.body.venues.find((v: { venueId: string }) => v.venueId === a.table6)).toMatchObject({ belowMinimum: true });
    const web = await t.http().get(`/api/v1/public/branches/${a.branchSlug}/reservation-availability?date=2026-10-01&time=11:30&guests=3`);
    expect(web.body).toMatchObject({ available: false, reason: 'too_soon' });

    // Дальше горизонта витрины (60 дней) — оператору можно.
    expect((await q('date=2026-12-15&time=19:00&guests=3')).body.available).toBe(true);
    const far = await t.http().get(`/api/v1/public/branches/${a.branchSlug}/reservation-availability?date=2026-12-15&time=19:00&guests=3`);
    expect(far.body.reason).toBe('too_far');

    // Занятость и перенос: своя бронь не мешает при excludeReservationId.
    const r = await create(staffBody(a));
    expect(venueIds((await q('date=2026-10-02&time=19:00&guests=3&typeCode=table')).body)).not.toContain(a.table4);
    const moving = await q(`date=2026-10-02&time=19:30&guests=3&excludeReservationId=${r.id}`);
    expect(venueIds(moving.body)).toContain(a.table4);
    expect(moving.body.venues.find((v: { venueId: string }) => v.venueId === a.table4)).toMatchObject({
      start: local('2026-10-02', '19:30').toISOString(),
      durationMinutes: expect.any(Number),
      blockedUntil: expect.any(String),
    });
    // Часы работы соблюдаются; вместимость — только максимум; прошлое — нет.
    expect((await q('date=2026-10-02&time=23:30&guests=3')).body).toMatchObject({ available: false, reason: 'closed', venues: [] });
    expect((await q('date=2026-10-02&time=19:00&guests=30')).body).toMatchObject({ available: false, reason: 'no_capacity', alternatives: [] });
    expect((await q('date=2026-10-01&time=09:00&guests=3')).body.reason).toBe('past');
    const byType = await q('date=2026-10-02&time=12:00&guests=3&typeCode=vip_hall');
    expect(venueIds(byType.body)).toEqual([a.vip]);
    expect(byType.body.venues[0]).toMatchObject({ belowMinimum: true, deposit: { amount: 5_000_000, currency: 'KZT' } });

    // Права: reservations.manage в филиале.
    expect((await get(`/availability?branchId=${b.branchId}&date=2026-10-02&time=19:00&guests=3`)).status).toBe(403);
    const { auth: banquet } = await tokenFor(t, [{ role: 'banquet_manager' }]);
    expect((await q('date=2026-10-02&time=19:00&guests=3', banquet)).status).toBe(403);
    expect((await get('/availability?date=2026-10-02&time=19:00&guests=3')).status).toBe(400);
    expect((await q('date=2026-10-02&time=25:00&guests=3')).status).toBe(400);
  });

  it('timeline: per-venue occupancy of the day including banquet holds, opening hours, blocking flag', async () => {
    const r = await book(t, bookingBody(a));
    const cancelled = await book(t, bookingBody(a, { venueId: a.table6, guests: 5, customer: { name: 'X', phone: '+77011110000' } }));
    await t.http().post(`/api/v1/public/reservations/${cancelled.token}/cancel`).send({});
    const hold = await t.get(VenueAvailability).holdForBanquet({
      venueId: a.yurt,
      start: local('2026-10-02', '12:00'),
      end: local('2026-10-02', '18:00'),
      guests: 18,
      banquetRequestId: newId(),
    });
    // Бронь предыдущего дня, заходящая за полночь, не попадает (закрытие в 00:00), следующий день — тоже нет.
    await create(staffBody(a, { date: '2026-10-03', time: '12:00' }));

    const res = await get(`/timeline?branchId=${a.branchId}&date=2026-10-02`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      branchId: a.branchId,
      date: '2026-10-02',
      timezone: 'Asia/Almaty',
      from: '2026-10-01T19:00:00.000Z',
      to: '2026-10-02T19:00:00.000Z',
    });
    expect(res.body.openingRanges).toEqual([{ start: '2026-10-02T05:00:00.000Z', end: '2026-10-02T19:00:00.000Z' }]);
    const venues = Object.fromEntries(
      res.body.halls[0].venues.map((v: { id: string; items: unknown[] }) => [v.id, v.items]),
    ) as Record<string, Array<Record<string, unknown>>>;
    expect(venues[a.table4]).toEqual([
      expect.objectContaining({
        number: r.number,
        status: 'confirmed',
        blocking: true,
        kind: 'regular',
        blockedUntil: '2026-10-02T16:15:00.000Z',
        holdExpiresAt: null,
      }),
    ]);
    // Правила места (длительность, уборка) и подложка зала — для построения сетки и карты.
    expect(res.body.halls[0]).toMatchObject({ background: null });
    const table4 = res.body.halls[0].venues.find((v: { id: string }) => v.id === a.table4);
    expect(table4.rules).toMatchObject({ durationMinutes: 120, cleanupMinutes: 15, bookableOnline: true });
    const phoneOnlyVenue = res.body.halls[0].venues.find((v: { id: string }) => v.id === a.phoneOnly);
    expect(phoneOnlyVenue).toMatchObject({ bookableOnline: false, rules: { bookableOnline: false } });
    expect(venues[a.table6]).toEqual([]);
    expect(venues[a.yurt]).toEqual([expect.objectContaining({ reservationId: hold.reservationId, kind: 'banquet', status: 'confirmed', guests: 18 })]);

    expect((await get(`/timeline?branchId=${b.branchId}&date=2026-10-02`)).status).toBe(403);
    expect((await get(`/timeline?branchId=${a.branchId}`)).status).toBe(400);
    // Банкетной занятостью управляет модуль банкетов, не админка броней.
    const banquetAction = await post(`${hold.reservationId}/cancel`, { reason: 'x' });
    expect(banquetAction.status).toBe(409);
    expect(banquetAction.body.error.code).toBe('reservation.banquet_hold');
  });

  it('detail: history of statuses with actors, deposit payment, rules snapshot', async () => {
    const r = await create(staffBody(a, { venueId: a.vip, guests: 8, deposit: { mode: 'payment_link' } }));
    t.clock.advance(minutes(5));
    await payDeposit(t, fakes, r.depositPayment.id);
    const res = await get(`/${r.id}`);
    expect(res.body).toMatchObject({
      status: 'confirmed',
      rules: { cancellationDeadlineHours: 24, cleanupMinutes: 30, durationMinutes: 180 },
      cancellationDeadline: '2026-10-01T14:00:00.000Z',
      depositPayment: { id: r.depositPayment.id, status: 'succeeded', amount: { amount: 5_000_000, currency: 'KZT' } },
      durationMinutes: 180,
    });
    expect(res.body.history.map((h: { from: string | null; to: string; actorKind: string }) => [h.from, h.to, h.actorKind])).toEqual([
      [null, 'awaiting_deposit', 'staff'],
      ['awaiting_deposit', 'confirmed', 'system'],
    ]);
  });
});
