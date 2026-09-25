import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Fakes } from '../../../test/fakes';
import { TestApp } from '../../../test/support/test-app';
import { ConflictError, NotFoundError, ValidationError } from '../../shared/kernel/errors';
import { newId } from '../../shared/kernel/ids';
import { zonedTimeToUtc } from '../../shared/kernel/time';
import { ReservationEvents, VenueAvailability } from './public';
import {
  auditActions,
  book,
  bookingBody,
  createLayout,
  createReservationTestApp,
  outboxEvents,
  resetFakes,
  VenueLayout,
} from './testing/reservation-test-kit';

const local = (date: string, time: string) => zonedTimeToUtc(date, time, 'Asia/Almaty');

describe('Reservation: VenueAvailability contract for Banquet (integration)', () => {
  let t: TestApp;
  let fakes: Fakes;
  let layout: VenueLayout;
  let venues: VenueAvailability;

  beforeAll(async () => {
    ({ t, fakes } = await createReservationTestApp());
    venues = t.get(VenueAvailability);
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    resetFakes(fakes);
    t.clock.set(local('2026-10-01', '11:00'));
    layout = await createLayout(t);
  });

  const hold = (overrides: Partial<Parameters<VenueAvailability['holdForBanquet']>[0]> = {}) =>
    venues.holdForBanquet({
      venueId: layout.vip,
      start: local('2026-10-02', '18:00'),
      end: local('2026-10-02', '23:00'),
      guests: 12,
      banquetRequestId: newId(),
      note: 'Свадьба',
      ...overrides,
    });

  it('listVenues / getVenue: venue summaries of the branch', async () => {
    const list = await venues.listVenues(layout.branchId);
    expect(list).toHaveLength(5);
    expect(list.find((v) => v.id === layout.vip)).toEqual({
      id: layout.vip,
      branchId: layout.branchId,
      hallId: layout.hallId,
      hallName: { ru: 'Основной зал', kk: 'Негізгі зал' },
      name: { ru: 'VIP-зал «Алтын»' },
      typeId: layout.types.vip_hall,
      typeCode: 'vip_hall',
      typeName: { ru: 'VIP-зал', kk: 'VIP-зал', en: 'VIP room' },
      capacityMin: 6,
      capacityMax: 12,
      deposit: { amount: 5_000_000, currency: 'KZT' },
      isActive: true,
    });
    expect((await venues.getVenue(layout.table4)).typeCode).toBe('table');
    await expect(venues.getVenue(newId())).rejects.toThrow(NotFoundError);
  });

  it('banquet hold occupies the venue: regular booking is rejected, availability hides it; event published', async () => {
    const banquetRequestId = newId();
    const { reservationId } = await hold({ banquetRequestId });
    const [created] = await outboxEvents(t, ReservationEvents.ReservationCreated);
    expect(created!.payload).toMatchObject({
      reservationId,
      kind: 'banquet',
      status: 'confirmed',
      source: 'banquet',
      banquetRequestId,
      venueTypeCode: 'vip_hall',
      guests: 12,
      deposit: null,
      publicToken: null,
      customer: { customerId: null, phone: null, name: null },
    });
    expect(fakes.notifier.guest).toHaveLength(0);
    expect((await auditActions(t, reservationId)).map((a) => a.action)).toEqual(['reservation.created']);

    const regular = await book(t, bookingBody(layout, { venueId: layout.vip, guests: 8, time: '19:00' }), 409);
    expect(regular.error.code).toBe('reservation.venue_occupied');
    const available = await t.http().get(`/api/v1/public/branches/${layout.branchSlug}/reservation-availability?date=2026-10-02&time=19:00&guests=8`);
    expect(available.body.venues.map((v: { venueId: string }) => v.venueId)).not.toContain(layout.vip);

    expect(await venues.isAvailable(layout.vip, local('2026-10-02', '12:00'), local('2026-10-02', '15:00'))).toBe(true);
    // Буфер уборки VIP-зала — 30 минут: 17:31-18:00 + уборка задевает банкет с 18:00.
    expect(await venues.isAvailable(layout.vip, local('2026-10-02', '15:00'), local('2026-10-02', '17:31'))).toBe(false);
    expect(await venues.isAvailable(layout.vip, local('2026-10-02', '15:00'), local('2026-10-02', '17:30'))).toBe(true);
    expect(await venues.isAvailable(layout.vip, local('2026-10-02', '20:00'), local('2026-10-02', '21:00'), reservationId)).toBe(true);
  });

  it('regular booking blocks the banquet hold (cleanup buffer included); capacity is checked', async () => {
    await book(t, bookingBody(layout, { venueId: layout.vip, guests: 8, time: '12:00' })); // 12:00-15:00 + 30 минут уборки
    await expect(hold({ start: local('2026-10-02', '15:20'), end: local('2026-10-02', '20:00') })).rejects.toMatchObject({
      code: 'reservation.venue_occupied',
    });
    await expect(hold({ start: local('2026-10-02', '15:30'), end: local('2026-10-02', '20:00') })).resolves.toHaveProperty('reservationId');
    await expect(hold({ venueId: layout.yurt, guests: 25 })).rejects.toThrow(ValidationError);
    await expect(hold({ venueId: layout.yurt, guests: 25 })).rejects.toMatchObject({ code: 'reservation.capacity_exceeded' });
    await expect(hold({ venueId: newId() })).rejects.toThrow(NotFoundError);
    await expect(hold({ start: local('2026-10-02', '20:00'), end: local('2026-10-02', '19:00'), venueId: layout.yurt })).rejects.toThrow(ValidationError);
  });

  it('concurrent banquet holds and bookings of one hall: only one wins', async () => {
    const results = await Promise.allSettled([
      hold(),
      hold(),
      hold({ start: local('2026-10-02', '19:00'), end: local('2026-10-02', '22:00') }),
      t.http().post('/api/v1/public/reservations').send(bookingBody(layout, { venueId: layout.vip, guests: 8, time: '19:00' })),
    ]);
    const holds = results.slice(0, 3);
    const http = results[3] as PromiseFulfilledResult<{ status: number }>;
    const wins = holds.filter((r) => r.status === 'fulfilled').length + (http.value.status === 201 ? 1 : 0);
    expect(wins).toBe(1);
    for (const r of holds.filter((x): x is PromiseRejectedResult => x.status === 'rejected')) {
      expect(r.reason).toBeInstanceOf(ConflictError);
    }
  });

  it('moveBanquetHold: to another hall / time with the same checks; ReservationRescheduled; repeat is a no-op', async () => {
    const banquetRequestId = newId();
    const { reservationId } = await hold({ banquetRequestId });
    await book(t, bookingBody(layout, { venueId: layout.yurt, guests: 12, date: '2026-10-03', time: '12:00' }));

    await expect(
      venues.moveBanquetHold(reservationId, { venueId: layout.yurt, start: local('2026-10-03', '14:00'), end: local('2026-10-03', '20:00'), guests: 15 }),
    ).rejects.toMatchObject({ code: 'reservation.venue_occupied' });
    await expect(
      venues.moveBanquetHold(reservationId, { venueId: layout.table4, start: local('2026-10-03', '17:00'), end: local('2026-10-03', '22:00'), guests: 12 }),
    ).rejects.toMatchObject({ code: 'reservation.capacity_exceeded' });

    const target = { venueId: layout.yurt, start: local('2026-10-03', '17:00'), end: local('2026-10-03', '22:00'), guests: 18 };
    await venues.moveBanquetHold(reservationId, target);
    await venues.moveBanquetHold(reservationId, target);
    const events = await outboxEvents(t, ReservationEvents.ReservationRescheduled);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      reservationId,
      kind: 'banquet',
      status: 'confirmed',
      banquetRequestId,
      from: { venueId: layout.vip, venueTypeCode: 'vip_hall', guests: 12 },
      to: { venueId: layout.yurt, venueTypeCode: 'yurt', guests: 18, start: '2026-10-03T12:00:00.000Z', end: '2026-10-03T17:00:00.000Z' },
    });
    // Прежний зал свободен.
    await book(t, bookingBody(layout, { venueId: layout.vip, guests: 8, time: '19:00' }));
    const occupancy = await venues.occupancy(layout.branchId, local('2026-10-03', '00:00'), local('2026-10-04', '00:00'));
    expect(occupancy.find((o) => o.reservationId === reservationId)).toMatchObject({ venueId: layout.yurt, kind: 'banquet', guests: 18 });
  });

  it('releaseBanquetHold: -> cancelled (idempotent), the hall becomes free; occupancy lists regular and banquet', async () => {
    const { reservationId } = await hold();
    const regular = await book(t, bookingBody(layout));
    const day = [local('2026-10-02', '00:00'), local('2026-10-03', '00:00')] as const;
    const occupancy = await venues.occupancy(layout.branchId, ...day);
    expect(occupancy.map((o) => o.kind).sort()).toEqual(['banquet', 'regular']);
    expect(occupancy.find((o) => o.kind === 'regular')).toMatchObject({ venueId: layout.table4, status: 'confirmed', banquetRequestId: null, guests: 3 });
    expect(regular.status).toBe('confirmed');

    await venues.releaseBanquetHold(reservationId, 'Банкет отменён');
    await venues.releaseBanquetHold(reservationId, 'Банкет отменён');
    const changes = await outboxEvents(t, ReservationEvents.ReservationStatusChanged);
    expect(changes.map((c) => c.payload)).toEqual([
      expect.objectContaining({ reservationId, kind: 'banquet', from: 'confirmed', to: 'cancelled', reason: 'Банкет отменён', depositOutcome: 'none' }),
    ]);
    expect(await venues.isAvailable(layout.vip, local('2026-10-02', '18:00'), local('2026-10-02', '23:00'))).toBe(true);
    expect((await venues.occupancy(layout.branchId, ...day)).map((o) => o.kind)).toEqual(['regular']);
    await expect(venues.moveBanquetHold(reservationId, { venueId: layout.vip, start: local('2026-10-05', '18:00'), end: local('2026-10-05', '20:00'), guests: 10 })).rejects.toMatchObject({
      code: 'reservation.cannot_reschedule',
    });
    // Обычная бронь — не банкетная занятость.
    const regularId = (await venues.occupancy(layout.branchId, ...day))[0]!.reservationId;
    await expect(venues.releaseBanquetHold(regularId, 'x')).rejects.toMatchObject({ code: 'reservation.not_banquet_hold' });
    await expect(venues.releaseBanquetHold(newId(), 'x')).rejects.toThrow(NotFoundError);
  });
});
