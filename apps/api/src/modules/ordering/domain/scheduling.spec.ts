import { describe, expect, it } from 'vitest';
import { WEEKDAYS } from '../../../shared/kernel/time';
import { asapAvailability, assertAsapAvailable, assertSchedulable, orderSlots, promisedTime, ScheduleRules, schedulableDates } from './scheduling';

// Каждый день 10:00–23:00 по Астане (UTC+5).
const rules: ScheduleRules = {
  openingHours: Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '10:00', close: '23:00' }]])),
  timezone: 'Asia/Almaty',
  leadMinutes: 60,
  maxScheduleDaysAhead: 2,
};

const at = (local: string) => new Date(`${local}+05:00`);

describe('ASAP availability', () => {
  it('available when open and the lead time fits before closing', () => {
    const r = asapAvailability(rules, at('2026-10-01T12:00:00'));
    expect(r.available).toBe(true);
    expect(r.readyAt?.toISOString()).toBe(at('2026-10-01T13:00:00').toISOString());
  });

  it('closed before opening and after closing', () => {
    expect(asapAvailability(rules, at('2026-10-01T09:30:00'))).toMatchObject({ available: false, reason: 'closed' });
    expect(asapAvailability(rules, at('2026-10-01T23:30:00'))).toMatchObject({ available: false, reason: 'closed' });
    expect(() => assertAsapAvailable(rules, at('2026-10-01T09:30:00'))).toThrow(expect.objectContaining({ code: 'order.branch_closed' }));
  });

  it('not available when the kitchen cannot finish before closing', () => {
    expect(asapAvailability(rules, at('2026-10-01T22:10:00'))).toMatchObject({ available: false, reason: 'closing_soon' });
    expect(() => assertAsapAvailable(rules, at('2026-10-01T22:10:00'))).toThrow(expect.objectContaining({ code: 'order.asap_closing_soon' }));
    expect(asapAvailability(rules, at('2026-10-01T22:00:00')).available).toBe(true);
  });

  it('handles opening hours across midnight', () => {
    const night: ScheduleRules = { ...rules, openingHours: Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '18:00', close: '02:00' }]])) };
    expect(asapAvailability(night, at('2026-10-02T00:30:00')).available).toBe(true);
    expect(asapAvailability(night, at('2026-10-02T01:30:00')).reason).toBe('closing_soon');
  });
});

describe('order slots', () => {
  it('15-minute slots from opening + lead (or now + lead) until closing', () => {
    const slots = orderSlots(rules, at('2026-10-01T12:05:00'), '2026-10-01');
    expect(slots[0]!.toISOString()).toBe(at('2026-10-01T13:15:00').toISOString());
    expect(slots[slots.length - 1]!.toISOString()).toBe(at('2026-10-01T23:00:00').toISOString());
    expect(slots.every((s, i) => i === 0 || s.getTime() - slots[i - 1]!.getTime() === 15 * 60_000)).toBe(true);
  });

  it('future day starts at opening + lead', () => {
    const slots = orderSlots(rules, at('2026-10-01T12:05:00'), '2026-10-02');
    expect(slots[0]!.toISOString()).toBe(at('2026-10-02T11:00:00').toISOString());
  });

  it('no slots in the past or beyond maxScheduleDaysAhead', () => {
    expect(orderSlots(rules, at('2026-10-01T12:05:00'), '2026-09-30')).toEqual([]);
    expect(orderSlots(rules, at('2026-10-01T12:05:00'), '2026-10-04')).toEqual([]);
    expect(orderSlots(rules, at('2026-10-01T12:05:00'), '2026-10-03').length).toBeGreaterThan(0);
    expect(schedulableDates(rules, at('2026-10-01T12:05:00'))).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('rejects malformed dates', () => {
    expect(() => orderSlots(rules, at('2026-10-01T12:05:00'), '01.10.2026')).toThrow(expect.objectContaining({ code: 'order.invalid_date' }));
  });
});

describe('scheduled time validation', () => {
  const now = at('2026-10-01T12:00:00');

  it('accepts a time within hours and after the lead time', () => {
    expect(() => assertSchedulable(rules, now, at('2026-10-01T15:00:00'))).not.toThrow();
    expect(() => assertSchedulable(rules, now, at('2026-10-03T11:00:00'))).not.toThrow();
  });

  it('too early, too far, outside hours', () => {
    expect(() => assertSchedulable(rules, now, at('2026-10-01T12:30:00'))).toThrow(expect.objectContaining({ code: 'order.schedule_too_early' }));
    expect(() => assertSchedulable(rules, now, at('2026-10-04T12:00:00'))).toThrow(expect.objectContaining({ code: 'order.schedule_too_far' }));
    expect(() => assertSchedulable(rules, now, at('2026-10-02T10:30:00'))).toThrow(
      expect.objectContaining({ code: 'order.schedule_outside_hours' }),
    );
    expect(() => assertSchedulable(rules, now, at('2026-10-01T23:30:00'))).toThrow(
      expect.objectContaining({ code: 'order.schedule_outside_hours' }),
    );
  });

  it('promised time: scheduled time or start + eta, never earlier than the current promise', () => {
    const from = at('2026-10-01T12:00:00');
    expect(promisedTime({ scheduledFor: null, from, etaMinutes: 45 }).toISOString()).toBe(at('2026-10-01T12:45:00').toISOString());
    expect(promisedTime({ scheduledFor: at('2026-10-01T18:00:00'), from, etaMinutes: 45 }).toISOString()).toBe(at('2026-10-01T18:00:00').toISOString());
    expect(promisedTime({ scheduledFor: null, from, etaMinutes: 45, current: at('2026-10-01T13:00:00') }).toISOString()).toBe(
      at('2026-10-01T13:00:00').toISOString(),
    );
  });
});
