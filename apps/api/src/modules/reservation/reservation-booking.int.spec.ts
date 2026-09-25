import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { TestApp } from '../../../test/support/test-app';
import { Database } from '../../shared/infrastructure/database/database';
import { RateLimiter } from '../../shared/infrastructure/rate-limit/rate-limiter';
import { ConflictError } from '../../shared/kernel/errors';
import { newId } from '../../shared/kernel/ids';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { Reservation } from './domain/reservation';
import { ReservationRepository } from './infrastructure/reservation.repository';
import { VenueRepository } from './infrastructure/venue.repository';
import { CustomerAnonymizedPayload, CustomersEvents } from '../customers/public';
import { ReservationEvents } from './public';
import {
  book,
  bookingBody,
  createLayout,
  createReservationTestApp,
  createVenue,
  outboxEvents,
  publishAndDrain,
  resetFakes,
  VenueLayout,
} from './testing/reservation-test-kit';

const API = '/api/v1/public';
const local = (date: string, time: string) => zonedTimeToUtc(date, time, 'Asia/Almaty');

describe('Reservation: storefront booking (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let layout: VenueLayout;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
    // Параллельные запросы supertest к одному серверу.
    t.app.getHttpServer().setMaxListeners(50);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    // 01.10.2026 11:00 по Астане.
    t.clock.set(local('2026-10-01', '11:00'));
    layout = await createLayout(t);
  });

  it('books a table: confirmed, guest identified with consent, event, notifications, admin feed, reminder', async () => {
    const res = await book(t, bookingBody(layout));
    expect(res).toMatchObject({
      status: 'confirmed',
      date: '2026-10-02',
      time: '19:00',
      durationMinutes: 120,
      guests: 3,
      customerName: 'Айгерим',
      comment: 'У окна',
      deposit: null,
      canCancel: true,
      canPay: false,
      venue: { id: layout.table4, name: 'Стол 4', typeCode: 'table' },
      policy: { cancellationDeadlineHours: 2, requiresManualConfirmation: false },
    });
    expect(res.number).toMatch(/^R\d{4}-R-2026-000001$/);
    expect(res.start).toBe('2026-10-02T14:00:00.000Z');
    expect(res.token).toHaveLength(32);

    const customer = [...fakes.customers.customers.values()][0]!;
    expect(customer.phone).toBe('+77011234567');
    expect(fakes.customers.consents.map((c) => c.kind)).toEqual(['personal_data', 'marketing']);

    const [created] = await outboxEvents(t, ReservationEvents.ReservationCreated);
    expect(created!.payload).toMatchObject({
      number: res.number,
      branchId: layout.branchId,
      venueId: layout.table4,
      venueName: { ru: 'Стол 4', kk: '4-үстел' },
      venueTypeCode: 'table',
      kind: 'regular',
      status: 'confirmed',
      start: '2026-10-02T14:00:00.000Z',
      end: '2026-10-02T16:00:00.000Z',
      guests: 3,
      customer: { customerId: customer.id, phone: '+77011234567', name: 'Айгерим' },
      deposit: null,
      banquetRequestId: null,
      source: 'web',
      locale: 'ru',
      publicToken: res.token,
    });
    expect(created!.meta).toMatchObject({ branchId: layout.branchId });

    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.confirmed']);
    expect(fakes.notifier.guest[0]!.params).toMatchObject({ date: '02.10.2026', time: '19:00', guests: '3', venueName: 'Стол 4' });
    expect(fakes.notifier.staff.map((s) => s.template)).toEqual(['staff.reservation_new']);
    expect(fakes.adminFeed.events[0]).toMatchObject({ stream: 'reservations', kind: 'created', sound: true, branchId: layout.branchId });

    // Напоминание за 3 часа (настройка по умолчанию): задача на 16:00 по Астане.
    const jobs = await sql<{ available_at: Date }>`
      select available_at from platform.outbox where topic = 'reservation.send_reminder'`.execute(t.database.rootConnection());
    expect(jobs.rows.map((j) => j.available_at.toISOString())).toEqual(['2026-10-02T11:00:00.000Z']);

    const again = await t.http().get(`${API}/reservations/${res.token}?locale=kk`);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ number: res.number, venue: { name: '4-үстел' } });
    expect((await t.http().get(`${API}/reservations/unknown-token`)).status).toBe(404);
  });

  it('CONCURRENCY: 12 parallel requests for the same venue and time — exactly one succeeds, the rest get 409', async () => {
    const requests = Array.from({ length: 12 }, (_, i) =>
      t
        .http()
        .post(`${API}/reservations`)
        .send(bookingBody(layout, { customer: { name: `Гость ${i}`, phone: `+7701000${String(i).padStart(4, '0')}` } })),
    );
    const results = await Promise.all(requests);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);
    for (const r of results.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('reservation.venue_occupied');

    const rows = await sql<{ n: number }>`
      select count(*)::int as n from reservation.reservations
      where venue_id = ${layout.table4} and status in ('pending', 'awaiting_deposit', 'confirmed', 'arrived')`.execute(t.database.rootConnection());
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('CONCURRENCY: parallel requests for overlapping intervals of one venue — only one wins; other venues are independent', async () => {
    // Любые два интервала пересекаются: разница начал меньше 2 часов + 15 минут уборки.
    const times = ['18:00', '18:20', '18:40', '19:00', '19:20', '19:40', '20:00'];
    const results = await Promise.all([
      ...times.map((time, i) =>
        t
          .http()
          .post(`${API}/reservations`)
          .send(bookingBody(layout, { time, customer: { name: 'Гость', phone: `+7702000${String(i).padStart(4, '0')}` } })),
      ),
      t
        .http()
        .post(`${API}/reservations`)
        .send(bookingBody(layout, { venueId: layout.table6, guests: 5, customer: { name: 'Другой стол', phone: '+77030000001' } })),
    ]);
    const table4 = results.slice(0, times.length);
    expect(table4.filter((r) => r.status === 201)).toHaveLength(1);
    expect(table4.filter((r) => r.status === 409)).toHaveLength(times.length - 1);
    expect(results[times.length]!.status).toBe(201);
  });

  it('exclusion constraint is the second line of defence: an overlapping insert without the lock fails with venue_occupied', async () => {
    const repo = t.get(ReservationRepository);
    const venue = (await t.get(VenueRepository).findDetailed(layout.table4))!;
    const make = (start: string, end: string) =>
      Reservation.create(
        {
          id: newId(),
          number: `X-${newId().slice(-8)}`,
          branchId: layout.branchId,
          venueId: layout.table4,
          kind: 'regular',
          source: 'admin',
          start: new Date(start),
          end: new Date(end),
          rules: venue.rules,
          guests: 2,
          customer: { id: null, name: null, phone: null, email: null },
          locale: 'ru',
          publicToken: null,
          idempotencyKey: null,
          requiresConfirmation: false,
          deposit: null,
          createdByUserId: null,
        },
        t.clock.now(),
      );
    await t.get(Database).transaction(() => repo.insert(make('2026-10-02T14:00:00Z', '2026-10-02T16:00:00Z')));
    // Пересекается только буфером уборки (16:00-16:15).
    await expect(t.get(Database).transaction(() => repo.insert(make('2026-10-02T16:10:00Z', '2026-10-02T17:00:00Z')))).rejects.toThrow(
      ConflictError,
    );
    await expect(t.get(Database).transaction(() => repo.insert(make('2026-10-02T16:15:00Z', '2026-10-02T17:00:00Z')))).resolves.toBeUndefined();
  });

  it('reservations cannot be physically deleted (forbid_delete trigger)', async () => {
    await book(t, bookingBody(layout));
    await expect(sql`delete from reservation.reservations`.execute(t.database.rootConnection())).rejects.toThrow();
    const rows = await sql<{ n: number }>`select count(*)::int as n from reservation.reservations`.execute(t.database.rootConnection());
    expect(rows.rows[0]!.n).toBe(1);
    await expect(sql`update reservation.status_history set reason = 'x'`.execute(t.database.rootConnection())).rejects.toThrow();
  });

  it('cleanup buffer: [start, end + cleanup) of both reservations must not overlap', async () => {
    await book(t, bookingBody(layout, { time: '19:00' })); // 19:00-21:00, занято до 21:15
    const at2100 = await book(t, bookingBody(layout, { time: '21:00', customer: { name: 'Б', phone: '+77011111111' } }), 409);
    expect(at2100.error.code).toBe('reservation.venue_occupied');
    await book(t, bookingBody(layout, { time: '21:15', durationMinutes: 90, customer: { name: 'Б', phone: '+77011111111' } }));
    // 17:00 + 110 минут = 18:50, + 15 минут уборки = 19:05 — задевает бронь в 19:00.
    const before = await book(t, bookingBody(layout, { time: '17:00', durationMinutes: 110, customer: { name: 'В', phone: '+77012222222' } }), 409);
    expect(before.error.code).toBe('reservation.venue_occupied');
    await book(t, bookingBody(layout, { time: '16:45', durationMinutes: 120, customer: { name: 'В', phone: '+77012222222' } }));
  });

  it('capacity, opening hours (branch timezone), lead time and horizon are enforced', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ guests: 5 }, 'reservation.capacity_exceeded'],
      [{ guests: 1 }, 'reservation.capacity_below_minimum'],
      [{ time: '23:00' }, 'reservation.slot_closed'], // 23:00-01:00, закрытие в 00:00
      [{ time: '09:00' }, 'reservation.slot_closed'],
      [{ date: '2026-10-01', time: '11:30' }, 'reservation.slot_too_soon'],
      [{ date: '2026-10-01', time: '10:00' }, 'reservation.slot_past'],
      [{ date: '2027-01-15' }, 'reservation.slot_too_far'],
      [{ venueId: layout.phoneOnly }, 'reservation.venue_not_bookable_online'],
      [{ consent: { personalData: false } }, 'consent.required'],
      [{ customer: { name: 'A', phone: '12345' } }, 'phone.invalid'],
    ];
    for (const [overrides, code] of cases) {
      const res = await t.http().post(`${API}/reservations`).send(bookingBody(layout, overrides));
      expect(res.status, `${JSON.stringify(overrides)} -> ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body.error.code).toBe(code);
      t.get(RateLimiter).clearMemory();
    }
    // Длительность до закрытия ровно помещается: 22:00-00:00.
    await book(t, bookingBody(layout, { time: '22:00' }));
    // Неверный формат — 400 (DTO), неизвестное место — 404.
    expect((await t.http().post(`${API}/reservations`).send(bookingBody(layout, { time: '7pm' }))).status).toBe(400);
    expect((await t.http().post(`${API}/reservations`).send(bookingBody(layout, { venueId: newId() }))).status).toBe(404);
  });

  it('idempotency: a replay returns the same reservation; the key cannot be reused for another request', async () => {
    const body = bookingBody(layout);
    const first = await book(t, body);
    const second = await book(t, body);
    expect(second.token).toBe(first.token);
    const reused = await book(t, { ...body, venueId: layout.table6, guests: 4 }, 409);
    expect(reused.error.code).toBe('reservation.idempotency_key_reused');
    const rows = await sql<{ n: number }>`select count(*)::int as n from reservation.reservations`.execute(t.database.rootConnection());
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('phone verification is required for reservations without a deposit when the branch requires it', async () => {
    const strict = await createLayout(t, { settings: { requirePhoneVerificationForReservations: true }, types: layout.types });
    const denied = await book(t, bookingBody(strict), 422);
    expect(denied.error.code).toBe('phone.not_verified');
    await book(t, bookingBody(strict, { phoneVerificationToken: 'verified:+77011234567' }));
    // С депозитом подтверждение не нужно: гарантия — оплата.
    await book(t, bookingBody(strict, { venueId: strict.vip, guests: 8 }));
  });

  it('venue with manual confirmation: booking is pending with a hold', async () => {
    const manual = await createVenue(t, {
      hallId: layout.hallId,
      typeId: layout.types.table!,
      code: 'T20',
      capacityMin: 1,
      capacityMax: 8,
      rules: { requiresManualConfirmation: true, holdMinutes: 45 },
      position: { x: 0, y: 500 },
    });
    const res = await book(t, bookingBody(layout, { venueId: manual }));
    expect(res.status).toBe('pending');
    expect(res.holdExpiresAt).toBe(new Date(t.clock.now().getTime() + 45 * 60_000).toISOString());
    expect(fakes.notifier.guest.map((g) => g.template)).toEqual(['reservation.pending']);
    // Напоминание ставится только при подтверждении.
    const jobs = await sql<{ n: number }>`select count(*)::int as n from platform.outbox where topic = 'reservation.send_reminder'`.execute(
      t.database.rootConnection(),
    );
    expect(jobs.rows[0]!.n).toBe(0);
  });

  it('branch that does not accept reservations rejects online booking', async () => {
    const closed = await createLayout(t, { settings: { acceptsReservations: false }, types: layout.types });
    const res = await book(t, bookingBody(closed), 409);
    expect(res.error.code).toBe('reservation.branch_not_accepting');
    const availability = await t.http().get(`${API}/branches/${closed.branchSlug}/reservation-availability?date=2026-10-02&time=19:00&guests=2`);
    expect(availability.body).toMatchObject({ available: false, reason: 'not_accepting', venues: [], bookingWindow: null });
    const map = await t.http().get(`${API}/branches/${closed.branchSlug}/halls`);
    expect(map.body).toMatchObject({ acceptsReservations: false, bookingWindow: null });
  });

  it('guest anonymized in the guest base: contacts are erased from reservation snapshots', async () => {
    const res = await book(t, bookingBody(layout));
    const customerId = [...fakes.customers.customers.values()][0]!.id;
    await publishAndDrain<CustomerAnonymizedPayload>(t, CustomersEvents.CustomerAnonymized, { customerId, occurredAt: t.clock.now().toISOString() });
    const row = await sql<{ customer_name: string | null; customer_phone: string | null; customer_email: string | null; comment: string | null }>`
      select customer_name, customer_phone, customer_email, comment from reservation.reservations where public_token = ${res.token}`.execute(
      t.database.rootConnection(),
    );
    expect(row.rows[0]).toEqual({ customer_name: null, customer_phone: null, customer_email: null, comment: null });
    expect((await t.http().get(`${API}/reservations/${res.token}`)).body).toMatchObject({ customerName: null, comment: null });
  });

  it('rate limit on the booking form', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await t.http().post(`${API}/reservations`).send({})).status;
    }
    expect(last).toBe(429);
  });
});

describe('Reservation: availability and hall map (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let layout: VenueLayout;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    t.clock.set(local('2026-10-01', '11:00'));
    layout = await createLayout(t);
  });

  const availability = (query: string, slug = layout.branchSlug) => t.http().get(`${API}/branches/${slug}/reservation-availability?${query}`);

  it('shows only really free venues that fit the party, with deposit and rules', async () => {
    const res = await availability('date=2026-10-02&time=19:00&guests=4&locale=kk');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ branchId: layout.branchId, available: true, reason: null, guests: 4 });
    expect(res.body.venues.map((v: { venueId: string }) => v.venueId).sort()).toEqual([layout.table4, layout.table6].sort());
    const t4 = res.body.venues.find((v: { venueId: string }) => v.venueId === layout.table4);
    expect(t4).toMatchObject({
      name: '4-үстел',
      hallName: 'Негізгі зал',
      typeCode: 'table',
      deposit: null,
      start: '2026-10-02T14:00:00.000Z',
      end: '2026-10-02T16:00:00.000Z',
      durationMinutes: 120,
      rules: { cancellationDeadlineHours: 2, requiresManualConfirmation: false },
    });

    // Окно брони на запрошенную дату: сетка, длительность, интервал времён начала.
    expect(res.body.bookingWindow).toEqual({
      timezone: 'Asia/Almaty',
      slotStepMinutes: 30,
      durationMinutes: 120,
      minLeadMinutes: 60,
      maxDaysAhead: 60,
      earliestStart: local('2026-10-01', '12:00').toISOString(),
      latestStart: local('2026-11-30', '11:00').toISOString(),
      days: [
        {
          date: '2026-10-02',
          intervals: [{ from: '10:00', to: '22:00', fromAt: local('2026-10-02', '10:00').toISOString(), toAt: local('2026-10-02', '22:00').toISOString() }],
        },
      ],
    });
    const longer = await availability('date=2026-10-02&time=19:00&guests=4&durationMinutes=180');
    expect(longer.body.bookingWindow).toMatchObject({ durationMinutes: 180, days: [{ intervals: [{ from: '10:00', to: '21:00' }] }] });

    const vip = await availability('date=2026-10-02&time=19:00&guests=8&typeCode=vip_hall');
    expect(vip.body.venues).toEqual([
      expect.objectContaining({ venueId: layout.vip, deposit: { amount: 5_000_000, currency: 'KZT' }, durationMinutes: 180 }),
    ]);
    // Место только для брони по телефону на витрине не показывается.
    const two = await availability('date=2026-10-02&time=19:00&guests=2');
    expect(two.body.venues.map((v: { venueId: string }) => v.venueId)).toEqual([layout.table4]);
  });

  it('occupied venues (including banquet holds and cleanup buffer) are hidden; alternatives are suggested', async () => {
    await book(t, bookingBody(layout, { time: '18:00', durationMinutes: 240 })); // 18:00-22:00 + 15 минут уборки
    const res = await availability('date=2026-10-02&time=19:00&guests=3');
    expect(res.body).toMatchObject({ available: false, reason: 'occupied', venues: [] });
    const times = res.body.alternatives.map((a: { time: string }) => a.time);
    expect(times.length).toBeGreaterThan(0);
    expect(times).toContain('15:30');
    expect(times).not.toContain('16:00'); // 16:00 + 2 часа + уборка задевает 18:00
    expect(res.body.alternatives[0].venueIds).toEqual([layout.table4]);

    // Сразу после уборки место снова свободно, но бронь до закрытия уже не помещается.
    const late = await availability('date=2026-10-02&time=22:00&guests=3');
    expect(late.body.venues).toEqual([]);

    const nobody = await availability('date=2026-10-02&time=19:00&guests=30');
    expect(nobody.body).toMatchObject({ available: false, reason: 'no_capacity', alternatives: [] });
    const closed = await availability('date=2026-10-02&time=09:00&guests=3');
    expect(closed.body.reason).toBe('closed');
  });

  it('validates the query and the branch', async () => {
    expect((await availability('date=2026-10-02&time=19:00')).status).toBe(400);
    expect((await availability('date=02.10.2026&time=19:00&guests=2')).status).toBe(400);
    expect((await availability('date=2026-10-02&time=19:00&guests=2&foo=1')).status).toBe(400);
    expect((await availability('date=2026-10-02&time=19:00&guests=2', 'no-such-branch')).status).toBe(404);
  });

  it('hall map: halls with venue positions, availability flag for the requested slot', async () => {
    await book(t, bookingBody(layout));
    const map = await t.http().get(`${API}/branches/${layout.branchSlug}/halls?locale=ru`);
    expect(map.status).toBe(200);
    expect(map.body.halls).toHaveLength(1);
    const hall = map.body.halls[0];
    expect(hall).toMatchObject({ id: layout.hallId, name: 'Основной зал', planWidth: 1000, planHeight: 600, background: null });
    expect(hall.venues).toHaveLength(5);
    expect(hall.venues.find((v: { id: string }) => v.id === layout.yurt)).toMatchObject({
      position: { x: 700, y: 0, w: 200, h: 200, shape: 'circle', rotation: 0 },
      deposit: { amount: 10_000_000, currency: 'KZT' },
      bookableOnline: true,
      available: null,
    });
    expect(hall.venues.find((v: { id: string }) => v.id === layout.phoneOnly).bookableOnline).toBe(false);
    // Календарь брони: от сегодня до горизонта (60 дней), сегодня — с учётом упреждения.
    const calendar = map.body.bookingWindow;
    expect(calendar).toMatchObject({ slotStepMinutes: 30, durationMinutes: 120, minLeadMinutes: 60, maxDaysAhead: 60 });
    expect(calendar.days).toHaveLength(61);
    expect(calendar.days[0]).toMatchObject({ date: '2026-10-01', intervals: [{ from: '12:00', to: '22:00' }] });
    expect(calendar.days[1]).toMatchObject({ date: '2026-10-02', intervals: [{ from: '10:00', to: '22:00' }] });
    expect(calendar.days[60]).toMatchObject({ date: '2026-11-30', intervals: [{ from: '10:00', to: '11:00' }] });

    const slot = await t.http().get(`${API}/branches/${layout.branchSlug}/halls?date=2026-10-02&time=19:30&guests=4`);
    const flags = Object.fromEntries(slot.body.halls[0].venues.map((v: { id: string; available: boolean }) => [v.id, v.available]));
    expect(flags[layout.table4]).toBe(false); // занят
    expect(flags[layout.table6]).toBe(true);
    expect(flags[layout.vip]).toBe(false); // вместимость от 6
    expect(flags[layout.phoneOnly]).toBe(false); // только по телефону
  });
});
