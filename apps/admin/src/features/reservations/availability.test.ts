import { describe, expect, it } from 'vitest';
import { alternativeOptions, availabilityQuery, isVenueFree, slotsByHall, venueStateAt } from './availability';
import { byHoldExpiry, formatDuration, holdCountdown, timelineHold } from './hold-countdown';
import { zonedToMs } from './timeline-layout';
import type { AdminVenueSlot, TimelineItem } from './types';

const TZ = 'Asia/Almaty';
const at = (time: string) => zonedToMs('2026-10-25', time, TZ);
const iso = (time: string) => new Date(at(time)).toISOString();

const slot = (venueId: string, hallId: string, capacityMax: number, extra: Partial<AdminVenueSlot> = {}): AdminVenueSlot => ({
  venueId,
  hallId,
  hallName: { ru: hallId === 'h1' ? 'Основной зал' : 'Терраса' },
  code: venueId.toUpperCase(),
  name: { ru: venueId },
  typeCode: 'table',
  typeName: { ru: 'Стол' },
  capacityMin: 1,
  capacityMax,
  belowMinimum: false,
  deposit: null,
  start: iso('19:00'),
  end: iso('21:00'),
  blockedUntil: iso('21:15'),
  durationMinutes: 120,
  rules: { durationMinutes: 120, holdMinutes: 30, cancellationDeadlineHours: 24, requiresManualConfirmation: false, cleanupMinutes: 15, slotStepMinutes: 15, bookableOnline: true },
  bookableOnline: true,
  position: { x: 0, y: 0, w: 10, h: 10, rotation: 0, shape: 'rect' },
  ...extra,
});

describe('свободные места для оператора (GET /admin/reservations/availability)', () => {
  it('запрос уходит только при полном вводе; длительность и перенос — если заданы', () => {
    expect(availabilityQuery('b1', { date: '2026-10-25', time: '19:00', guests: 4 })).toEqual({ branchId: 'b1', date: '2026-10-25', time: '19:00', guests: 4 });
    expect(availabilityQuery('b1', { date: '2026-10-25', time: '19:00', guests: 4, durationMinutes: 90, excludeReservationId: 'r1' })).toEqual({
      branchId: 'b1',
      date: '2026-10-25',
      time: '19:00',
      guests: 4,
      durationMinutes: 90,
      excludeReservationId: 'r1',
    });
    expect(availabilityQuery('b1', { date: '2026-10-25', time: null, guests: 4 })).toBeNull();
    expect(availabilityQuery('b1', { date: '25.10.2026', time: '19:00', guests: 4 })).toBeNull();
    expect(availabilityQuery('b1', { date: '2026-10-25', time: '19:00', guests: 0 })).toBeNull();
  });

  it('места по залам: сначала без «меньше минимума», затем по вместимости', () => {
    const halls = slotsByHall([
      slot('big', 'h1', 10),
      slot('vip', 'h2', 20, { belowMinimum: true, capacityMin: 8 }),
      slot('t4', 'h1', 4),
      slot('small-vip', 'h1', 6, { belowMinimum: true }),
      slot('terrace', 'h2', 6),
    ]);
    expect(halls.map((h) => h.hallId)).toEqual(['h1', 'h2']);
    expect(halls[0]!.slots.map((s) => s.venueId)).toEqual(['t4', 'big', 'small-vip']);
    expect(halls[1]!.slots.map((s) => s.venueId)).toEqual(['terrace', 'vip']);
  });

  it('выбранное место остаётся, только если сервер считает его свободным', () => {
    const availability = { venues: [slot('t4', 'h1', 4)] };
    expect(isVenueFree(availability, 't4')).toBe(true);
    expect(isVenueFree(availability, 't6')).toBe(false);
    expect(isVenueFree(null, 't4')).toBe(false);
  });

  it('ближайшее свободное время: по порядку, без повторов, с отметкой текущего места', () => {
    const options = alternativeOptions(
      {
        alternatives: [
          { date: '2026-10-25', time: '21:30', start: iso('21:30'), venueIds: ['t4'] },
          { date: '2026-10-25', time: '20:30', start: iso('20:30'), venueIds: ['t4', 't6'] },
          { date: '2026-10-25', time: '20:30', start: iso('20:30'), venueIds: ['t6'] },
        ],
      },
      't6',
    );
    expect(options).toEqual([
      { date: '2026-10-25', time: '20:30', venues: 2, includesCurrent: true },
      { date: '2026-10-25', time: '21:30', venues: 1, includesCurrent: false },
    ]);
    expect(alternativeOptions(null)).toEqual([]);
  });
});

describe('состояние места на карте зала в выбранный момент', () => {
  const item = (id: string, start: string, end: string, blockedUntil: string, extra: Partial<TimelineItem> = {}): TimelineItem => ({
    reservationId: id,
    number: id,
    kind: 'regular',
    status: 'confirmed',
    blocking: true,
    start: iso(start),
    end: iso(end),
    blockedUntil: iso(blockedUntil),
    guests: 2,
    customerName: null,
    customerPhone: null,
    banquetRequestId: null,
    depositState: 'none',
    needsMark: false,
    holdExpiresAt: null,
    ...extra,
  });
  const items = [item('a', '12:00', '14:00', '14:30', { status: 'arrived' }), item('b', '18:00', '22:00', '22:30', { kind: 'banquet' })];

  it('гости за столом, уборка, скоро бронь, свободно, банкет', () => {
    expect(venueStateAt({ isActive: true, items }, at('13:00')).state).toBe('seated');
    expect(venueStateAt({ isActive: true, items }, at('14:10')).state).toBe('cleanup');
    expect(venueStateAt({ isActive: true, items }, at('15:00')).state).toBe('free');
    expect(venueStateAt({ isActive: true, items }, at('17:30'))).toMatchObject({ state: 'soon', item: { reservationId: 'b' } });
    expect(venueStateAt({ isActive: true, items }, at('19:00')).state).toBe('banquet');
    expect(venueStateAt({ isActive: false, items }, at('13:00')).state).toBe('inactive');
  });

  it('подтверждённая бронь — «забронировано»; неявка место не занимает', () => {
    expect(venueStateAt({ isActive: true, items: [item('c', '12:00', '14:00', '14:15')] }, at('12:30')).state).toBe('reserved');
    expect(venueStateAt({ isActive: true, items: [item('d', '12:00', '14:00', '14:15', { status: 'no_show', blocking: false })] }, at('12:30')).state).toBe('free');
  });
});

describe('обратный отсчёт удержания брони', () => {
  const now = Date.parse('2026-10-25T10:00:00Z');

  it('оставшееся время и срочность', () => {
    expect(holdCountdown('2026-10-25T10:20:00Z', now)).toEqual({ seconds: 1200, text: '20:00', urgency: 'ok' });
    expect(holdCountdown('2026-10-25T10:10:05Z', now)).toMatchObject({ text: '10:05', urgency: 'warning' });
    expect(holdCountdown('2026-10-25T10:04:59Z', now)).toMatchObject({ text: '4:59', urgency: 'critical' });
    expect(holdCountdown('2026-10-25T09:59:00Z', now)).toMatchObject({ seconds: 0, text: '0:00', urgency: 'expired' });
    expect(holdCountdown(null, now)).toBeNull();
    expect(formatDuration(3 * 3600 + 5 * 60 + 7)).toBe('3:05:07');
  });

  it('плашка календаря: минуты до снятия только у ждущих подтверждения / депозита', () => {
    expect(timelineHold({ status: 'pending', holdExpiresAt: '2026-10-25T10:12:01Z' }, now)).toEqual({ minutes: 13, urgency: 'warning' });
    expect(timelineHold({ status: 'awaiting_deposit', holdExpiresAt: '2026-10-25T10:03:00Z' }, now)).toEqual({ minutes: 3, urgency: 'critical' });
    expect(timelineHold({ status: 'awaiting_deposit', holdExpiresAt: '2026-10-25T09:00:00Z' }, now)).toEqual({ minutes: 0, urgency: 'expired' });
    expect(timelineHold({ status: 'confirmed', holdExpiresAt: '2026-10-25T10:12:00Z' }, now)).toBeNull();
    expect(timelineHold({ status: 'pending', holdExpiresAt: null }, now)).toBeNull();
  });

  it('очередь — по времени снятия, без удержания — в конце', () => {
    const list = [
      { id: 'none', holdExpiresAt: null, start: '2026-10-25T12:00:00Z' },
      { id: 'late', holdExpiresAt: '2026-10-25T11:00:00Z', start: '2026-10-25T12:00:00Z' },
      { id: 'soon', holdExpiresAt: '2026-10-25T10:05:00Z', start: '2026-10-25T13:00:00Z' },
    ];
    expect([...list].sort(byHoldExpiry).map((r) => r.id)).toEqual(['soon', 'late', 'none']);
  });
});
