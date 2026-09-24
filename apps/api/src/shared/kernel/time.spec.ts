import { describe, expect, it } from 'vitest';
import { isOpenAt, isWithinOpeningHours, openingRangesForDate, TimeRange, toLocalDate, toLocalTime, zonedTimeToUtc } from './time';

describe('time (Asia/Almaty)', () => {
  it('converts local branch time to UTC and back', () => {
    const utc = zonedTimeToUtc('2026-10-02', '19:30');
    expect(toLocalDate(utc)).toBe('2026-10-02');
    expect(toLocalTime(utc)).toBe('19:30');
    // С 2024 года Казахстан живёт в UTC+5.
    expect(utc.toISOString()).toBe('2026-10-02T14:30:00.000Z');
  });

  const hours = { fri: [{ open: '10:00', close: '02:00' }], sat: [{ open: '12:00', close: '23:00' }] };

  it('handles intervals crossing midnight', () => {
    const fridayNight = zonedTimeToUtc('2026-10-03', '01:30'); // суббота 01:30, хвост пятницы
    expect(isOpenAt(hours, fridayNight)).toBe(true);
    expect(isOpenAt(hours, zonedTimeToUtc('2026-10-03', '03:00'))).toBe(false);
    expect(isOpenAt(hours, zonedTimeToUtc('2026-10-03', '12:30'))).toBe(true);
    expect(openingRangesForDate(hours, '2026-10-03')).toHaveLength(2);
  });

  it('checks a range fits opening hours', () => {
    const inside = new TimeRange(zonedTimeToUtc('2026-10-02', '22:00'), zonedTimeToUtc('2026-10-03', '01:00'));
    const outside = new TimeRange(zonedTimeToUtc('2026-10-02', '23:00'), zonedTimeToUtc('2026-10-03', '03:00'));
    expect(isWithinOpeningHours(hours, inside)).toBe(true);
    expect(isWithinOpeningHours(hours, outside)).toBe(false);
  });

  it('detects overlapping ranges (half-open)', () => {
    const a = new TimeRange(new Date('2026-10-02T10:00:00Z'), new Date('2026-10-02T12:00:00Z'));
    const b = new TimeRange(new Date('2026-10-02T12:00:00Z'), new Date('2026-10-02T13:00:00Z'));
    const c = new TimeRange(new Date('2026-10-02T11:59:00Z'), new Date('2026-10-02T13:00:00Z'));
    expect(a.overlaps(b)).toBe(false);
    expect(a.overlaps(c)).toBe(true);
    expect(() => new TimeRange(b.end, b.start)).toThrow();
  });
});
