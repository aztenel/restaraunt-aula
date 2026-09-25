import { describe, expect, it } from 'vitest';
import { noFreeReason, venueChoices, venueSlot, venueStateAt, type BookableVenue, type OccupancyItem } from './availability';
import { byHoldExpiry, formatDuration, holdCountdown } from './hold-countdown';
import { zonedToMs } from './timeline-layout';
import type { TimelineItem } from './types';

const TZ = 'Asia/Almaty';
const at = (time: string) => zonedToMs('2026-10-25', time, TZ);
const iso = (time: string) => new Date(at(time)).toISOString();
const OPEN = [{ start: iso('10:00'), end: iso('23:00') }];
const NOW = at('09:00');

const venue = (id: string, capacityMax: number, extra: Partial<BookableVenue> = {}): BookableVenue => ({
  id,
  hallId: 'h1',
  capacityMin: 1,
  capacityMax,
  isBookable: true,
  rules: { durationMinutes: 120, cleanupMinutes: 15 },
  ...extra,
});
const busy = (reservationId: string, start: string, blockedUntil: string, blocking = true): OccupancyItem => ({
  reservationId,
  blocking,
  start: iso(start),
  blockedUntil: iso(blockedUntil),
});

describe('предварительный подбор свободных мест для брони оператором', () => {
  const request = { start: at('19:00'), guests: 4, durationMinutes: null, now: NOW, openingRanges: OPEN };

  it('длительность и буфер уборки — по правилу места', () => {
    const slot = venueSlot(venue('t1', 4), [], request);
    expect(slot).toMatchObject({ status: 'free', durationMinutes: 120, end: at('21:00'), blockedUntil: at('21:15') });
    expect(venueSlot(venue('t1', 4), [], { ...request, durationMinutes: 90 }).end).toBe(at('20:30'));
  });

  it('пересечение с занятостью другой брони (включая её буфер) — занято', () => {
    expect(venueSlot(venue('t1', 4), [busy('r1', '17:00', '19:15')], request)).toMatchObject({ status: 'occupied', conflictId: 'r1' });
    // Своя уборка до начала следующей брони: 19:00–21:00 + 15 минут пересекается с бронью с 21:10.
    expect(venueSlot(venue('t1', 4), [busy('r2', '21:10', '23:00')], request).status).toBe('occupied');
    // Касание границ — не пересечение.
    expect(venueSlot(venue('t1', 4), [busy('r3', '17:00', '19:00'), busy('r4', '21:15', '23:00')], request).status).toBe('free');
  });

  it('не занимающие место брони (не пришли) и переносимая бронь не мешают', () => {
    expect(venueSlot(venue('t1', 4), [busy('r1', '19:00', '21:15', false)], request).status).toBe('free');
    expect(venueSlot(venue('t1', 4), [busy('self', '19:00', '21:15')], { ...request, excludeReservationId: 'self' }).status).toBe('free');
  });

  it('вместимость: больше максимума — нельзя; меньше минимума — можно оператору, с предупреждением', () => {
    expect(venueSlot(venue('t1', 2), [], request).status).toBe('too_many_guests');
    const small = venueSlot(venue('vip', 20, { capacityMin: 8 }), [], request);
    expect(small).toMatchObject({ status: 'free', belowMinimum: true });
  });

  it('часы работы, прошлое (с запасом 15 минут на «живую» посадку), выключенное место', () => {
    expect(venueSlot(venue('t1', 4), [], { ...request, start: at('22:00') }).status).toBe('closed');
    expect(venueSlot(venue('t1', 4), [], { ...request, start: at('12:00'), now: at('12:10') }).status).toBe('free');
    expect(venueSlot(venue('t1', 4), [], { ...request, start: at('12:00'), now: at('12:20') }).status).toBe('past');
    expect(venueSlot(venue('t1', 4, { isBookable: false }), [], request).status).toBe('inactive');
  });

  it('выбор: только свободные, ближайшие по вместимости — первыми', () => {
    const venues = [venue('big', 10), venue('t4', 4), venue('t6', 6), venue('taken', 4), venue('t2', 2)];
    const occupancy = new Map([['taken', [busy('r1', '18:00', '20:15')]]]);
    const free = venueChoices(venues, occupancy, request, { onlyFree: true });
    expect(free.map((c) => c.venue.id)).toEqual(['t4', 't6', 'big']);
    const all = venueChoices(venues, occupancy, request);
    expect(all.map((c) => c.slot.status)).toEqual(['free', 'free', 'free', 'occupied', 'too_many_guests']);
    expect(noFreeReason(all)).toBeNull();
  });

  it('почему нет мест: закрыто / занято / нет мест подходящей вместимости', () => {
    const venues = [venue('t4', 4)];
    expect(noFreeReason(venueChoices(venues, new Map(), { ...request, start: at('22:30') }))).toBe('closed');
    expect(noFreeReason(venueChoices(venues, new Map([['t4', [busy('r', '18:00', '22:00')]]]), request))).toBe('occupied');
    expect(noFreeReason(venueChoices(venues, new Map(), { ...request, guests: 9 }))).toBe('too_many_guests');
    expect(noFreeReason([])).toBe('no_venues');
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

  it('очередь — по времени снятия, без удержания — в конце', () => {
    const list = [
      { id: 'none', holdExpiresAt: null, start: '2026-10-25T12:00:00Z' },
      { id: 'late', holdExpiresAt: '2026-10-25T11:00:00Z', start: '2026-10-25T12:00:00Z' },
      { id: 'soon', holdExpiresAt: '2026-10-25T10:05:00Z', start: '2026-10-25T13:00:00Z' },
    ];
    expect([...list].sort(byHoldExpiry).map((r) => r.id)).toEqual(['soon', 'late', 'none']);
  });
});
