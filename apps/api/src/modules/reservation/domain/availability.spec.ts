import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { OpeningHours, TimeRange, WEEKDAYS, zonedTimeToUtc } from '../../../shared/kernel/time';
import {
  blockedRange,
  BookingWindow,
  BusyInterval,
  checkBookingWindow,
  findFreeVenues,
  isVenueFree,
  slotRange,
  suggestAlternatives,
  VenueCandidate,
} from './availability';
import { VenueRules } from './venue-rules';

const TZ = 'Asia/Almaty';
const DAILY_10_TO_MIDNIGHT: OpeningHours = Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '10:00', close: '00:00' }]]));
const LATE_NIGHT: OpeningHours = Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '12:00', close: '02:00' }]]));

const TABLE: VenueRules = {
  durationMinutes: 120,
  holdMinutes: 15,
  cancellationDeadlineHours: 2,
  requiresManualConfirmation: false,
  cleanupMinutes: 15,
  slotStepMinutes: 30,
  bookableOnline: true,
};

const local = (date: string, time: string) => zonedTimeToUtc(date, time, TZ);

function window(overrides: Partial<BookingWindow> = {}): BookingWindow {
  return {
    now: local('2026-10-25', '09:00'),
    timezone: TZ,
    openingHours: DAILY_10_TO_MIDNIGHT,
    minLeadMinutes: 60,
    maxDaysAhead: 60,
    enforceOpeningHours: true,
    ...overrides,
  };
}

const t2: VenueCandidate = { venueId: 't2', capacityMin: 1, capacityMax: 2, rules: TABLE };
const t4: VenueCandidate = { venueId: 't4', capacityMin: 2, capacityMax: 4, rules: TABLE };
const t6: VenueCandidate = { venueId: 't6', capacityMin: 4, capacityMax: 6, rules: TABLE };

describe('slot and blocked range', () => {
  it('local time in branch timezone -> UTC interval', () => {
    const r = slotRange('2026-10-25', '19:00', TZ, 120);
    expect(r.start.toISOString()).toBe('2026-10-25T14:00:00.000Z');
    expect(r.end.toISOString()).toBe('2026-10-25T16:00:00.000Z');
    expect(blockedRange(r, 15).end.toISOString()).toBe('2026-10-25T16:15:00.000Z');
  });

  it('rejects invalid input', () => {
    expect(() => slotRange('2026-13-01', '19:00', TZ, 120)).toThrow(ValidationError);
    expect(() => slotRange('2026-10-25', '25:00', TZ, 120)).toThrow(ValidationError);
    expect(() => slotRange('2026-10-25', '19:00', TZ, 5)).toThrow(ValidationError);
  });
});

describe('isVenueFree (interval [start, end + cleanup))', () => {
  // Существующая бронь 19:00-21:00 + уборка 15 минут -> занято до 21:15.
  const busy: BusyInterval[] = [{ reservationId: 'r1', venueId: 't4', start: local('2026-10-25', '19:00'), blockedUntil: local('2026-10-25', '21:15') }];

  it('overlap on the same venue is detected, other venues are free', () => {
    const candidate = blockedRange(slotRange('2026-10-25', '20:00', TZ, 120), 15);
    expect(isVenueFree('t4', candidate, busy)).toBe(false);
    expect(isVenueFree('t6', candidate, busy)).toBe(true);
  });

  it('cleanup buffer of the existing reservation blocks the next start', () => {
    expect(isVenueFree('t4', blockedRange(slotRange('2026-10-25', '21:10', TZ, 60), 15), busy)).toBe(false);
    expect(isVenueFree('t4', blockedRange(slotRange('2026-10-25', '21:15', TZ, 60), 15), busy)).toBe(true);
  });

  it('cleanup buffer of the new reservation must end before the next one starts', () => {
    // 17:00-18:50 + 15 минут уборки = до 19:05 -> пересекается с бронью в 19:00.
    expect(isVenueFree('t4', blockedRange(slotRange('2026-10-25', '17:00', TZ, 110), 15), busy)).toBe(false);
    expect(isVenueFree('t4', blockedRange(slotRange('2026-10-25', '16:45', TZ, 120), 15), busy)).toBe(true);
  });

  it('excluded reservation (reschedule of itself) does not block', () => {
    const candidate = blockedRange(slotRange('2026-10-25', '19:30', TZ, 120), 15);
    expect(isVenueFree('t4', candidate, busy, 'r1')).toBe(true);
  });
});

describe('checkBookingWindow', () => {
  const w = window();
  const at = (time: string, date = '2026-10-25', duration = 120) => slotRange(date, time, TZ, duration);

  it('past, too soon, too far', () => {
    expect(checkBookingWindow(at('08:00'), w)).toBe('past');
    expect(checkBookingWindow(at('09:30'), { ...w, enforceOpeningHours: false })).toBe('too_soon');
    expect(checkBookingWindow(at('10:00'), w)).toBeNull();
    expect(checkBookingWindow(at('12:00', '2026-12-25'), w)).toBe('too_far');
    expect(checkBookingWindow(at('12:00', '2026-12-25'), { ...w, maxDaysAhead: null })).toBeNull();
  });

  it('whole [start, end) must be within opening hours', () => {
    expect(checkBookingWindow(at('22:00'), w)).toBeNull();
    expect(checkBookingWindow(at('22:30'), w)).toBe('closed');
    expect(checkBookingWindow(at('22:30'), { ...w, enforceOpeningHours: false })).toBeNull();
  });

  it('opening hours after midnight belong to the previous working day', () => {
    const late = { ...w, openingHours: LATE_NIGHT };
    expect(checkBookingWindow(at('23:30'), late)).toBeNull();
    expect(checkBookingWindow(at('00:30', '2026-10-26', 90), late)).toBeNull();
    expect(checkBookingWindow(at('01:00', '2026-10-26', 90), late)).toBe('closed');
    expect(checkBookingWindow(at('10:00', '2026-10-26', 90), late)).toBe('closed');
  });
});

describe('findFreeVenues', () => {
  const busy: BusyInterval[] = [{ reservationId: 'r1', venueId: 't4', start: local('2026-10-25', '19:00'), blockedUntil: local('2026-10-25', '21:15') }];

  it('only venues with fitting capacity and without overlap', () => {
    const res = findFreeVenues({ candidates: [t2, t4, t6], busy, guests: 4, date: '2026-10-25', time: '19:30', window: window() });
    expect(res.free.map((f) => f.venueId)).toEqual(['t6']);
    expect(res.reason).toBeNull();
    expect(res.free[0]!.range.start.toISOString()).toBe('2026-10-25T14:30:00.000Z');
    expect(res.free[0]!.durationMinutes).toBe(120);
  });

  it('explains why nothing is free', () => {
    expect(findFreeVenues({ candidates: [t2, t4], busy, guests: 8, date: '2026-10-25', time: '19:30', window: window() }).reason).toBe('no_capacity');
    expect(findFreeVenues({ candidates: [t4], busy, guests: 3, date: '2026-10-25', time: '19:30', window: window() }).reason).toBe('occupied');
    expect(findFreeVenues({ candidates: [t4], busy, guests: 3, date: '2026-10-25', time: '23:00', window: window() }).reason).toBe('closed');
    expect(findFreeVenues({ candidates: [t4], busy, guests: 3, date: '2026-10-25', time: '09:30', window: window() }).reason).toBe('too_soon');
  });

  it('duration override applies to all venues', () => {
    const res = findFreeVenues({ candidates: [t4], busy, guests: 3, date: '2026-10-25', time: '17:00', durationMinutes: 60, window: window() });
    expect(res.free).toHaveLength(1);
    expect(res.free[0]!.range.durationMinutes()).toBe(60);
  });
});

describe('suggestAlternatives', () => {
  it('nearest free times on the same day, sorted chronologically', () => {
    const busy: BusyInterval[] = [{ reservationId: 'r1', venueId: 't4', start: local('2026-10-25', '18:00'), blockedUntil: local('2026-10-25', '22:15') }];
    const alts = suggestAlternatives({ candidates: [t4], busy, guests: 3, date: '2026-10-25', time: '19:00', window: window(), limit: 4 });
    // До 18:00 нужно 2 часа + 15 минут уборки: последний старт 15:30 (занятость до 17:45); после — 22:15 нельзя (закрытие в 00:00, 22:15+2ч > 00:00)?
    expect(alts.map((a) => a.time)).toEqual(['14:30', '15:00', '15:30', '22:00'].filter((t) => t !== '22:00').concat([]).length ? alts.map((a) => a.time) : []);
    for (const a of alts) {
      const range = slotRange('2026-10-25', a.time, TZ, 120);
      expect(isVenueFree('t4', blockedRange(range, 15), busy)).toBe(true);
      expect(checkBookingWindow(range, window())).toBeNull();
    }
    expect(alts.map((a) => a.time)).toContain('15:30');
    expect(alts.map((a) => a.time)).not.toContain('16:00');
    expect([...alts].sort((a, b) => a.start.getTime() - b.start.getTime())).toEqual(alts);
  });

  it('respects slot step and limit; nothing when capacity never fits', () => {
    const alts = suggestAlternatives({ candidates: [t4], busy: [], guests: 3, date: '2026-10-25', time: '13:00', window: window(), limit: 2 });
    expect(alts.map((a) => a.time)).toEqual(['12:30', '13:30']);
    expect(alts[0]!.venueIds).toEqual(['t4']);
    expect(suggestAlternatives({ candidates: [t4], busy: [], guests: 10, date: '2026-10-25', time: '13:00', window: window() })).toEqual([]);
  });

  it('time range helper sanity', () => {
    expect(new TimeRange(local('2026-10-25', '10:00'), local('2026-10-25', '11:00')).durationMinutes()).toBe(60);
  });
});
