import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { zonedTimeToUtc } from '../../../shared/kernel/time';
import { datesOf, localDateOf, monthPeriod, monthsOf, periodLength, reportPeriod, weekdayOfDate } from './period';

describe('reportPeriod', () => {
  it('defaults to the last 30 days ending today', () => {
    expect(reportPeriod({}, '2026-10-15')).toEqual({ from: '2026-09-16', to: '2026-10-15' });
  });

  it('accepts explicit bounds and a single day', () => {
    expect(reportPeriod({ from: '2026-10-01', to: '2026-10-01' }, '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(reportPeriod({ from: '2026-10-01' }, '2026-10-15')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
  });

  it('rejects invalid dates, reversed and too long periods', () => {
    expect(() => reportPeriod({ from: '2026-13-01' }, '2026-10-15')).toThrow(ValidationError);
    expect(() => reportPeriod({ from: '2026-10-02', to: '2026-10-01' }, '2026-10-15')).toThrowError(
      expect.objectContaining({ code: 'report.invalid_period' }),
    );
    expect(() => reportPeriod({ from: '2025-01-01', to: '2026-10-01' }, '2026-10-15')).toThrowError(
      expect.objectContaining({ code: 'report.period_too_long' }),
    );
  });

  it('enumerates dates across month boundaries', () => {
    const p = { from: '2026-09-29', to: '2026-10-02' };
    expect(datesOf(p)).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(periodLength(p)).toBe(4);
  });
});

describe('local dates (Asia/Almaty)', () => {
  it('assigns 23:30 and 00:30 local to different days', () => {
    expect(localDateOf(zonedTimeToUtc('2026-10-01', '23:30'))).toBe('2026-10-01');
    expect(localDateOf(zonedTimeToUtc('2026-10-02', '00:30'))).toBe('2026-10-02');
  });

  it('weekday of a calendar date', () => {
    expect(weekdayOfDate('2026-10-01')).toBe('thu');
    expect(weekdayOfDate('2026-10-04')).toBe('sun');
    expect(weekdayOfDate('2026-10-05')).toBe('mon');
  });
});

describe('months', () => {
  it('month period and months of a period', () => {
    expect(monthPeriod('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthPeriod('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(monthsOf({ from: '2026-11-15', to: '2027-01-10' })).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});
