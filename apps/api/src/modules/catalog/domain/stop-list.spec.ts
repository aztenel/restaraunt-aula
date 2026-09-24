import { describe, expect, it } from 'vitest';
import {
  AVAILABLE,
  displayAvailability,
  effectiveAvailability,
  endOfLocalDay,
  isStopExpired,
  restoreItem,
  STOP_LIST_MACHINE,
  stopItem,
} from './stop-list';

const now = new Date('2026-10-01T06:00:00Z'); // 11:00 в Астане (UTC+5)
const hour = 3_600_000;

describe('stop-list', () => {
  it('machine allows only available <-> stopped', () => {
    expect(STOP_LIST_MACHINE.canTransition('available', 'stopped')).toBe(true);
    expect(STOP_LIST_MACHINE.canTransition('stopped', 'available')).toBe(true);
    expect(STOP_LIST_MACHINE.canTransition('stopped', 'stopped')).toBe(false);
  });

  it('stops with optional until and reason', () => {
    const r = stopItem(AVAILABLE, { until: new Date(now.getTime() + 2 * hour), reason: ' закончилась конина ', source: 'manual', now });
    expect(r.transitioned).toBe(true);
    expect(r.state).toMatchObject({ availability: 'stopped', stopReason: 'закончилась конина', stopSource: 'manual', stoppedAt: now });
    expect(effectiveAvailability(r.state, now)).toBe('stopped');
  });

  it('repeated stop updates until without transition; same input — no change', () => {
    const first = stopItem(AVAILABLE, { until: null, source: 'pos', now }).state;
    const same = stopItem(first, { until: null, source: 'pos', now });
    expect(same.changed).toBe(false);
    const updated = stopItem(first, { until: new Date(now.getTime() + hour), source: 'pos', now });
    expect(updated.changed).toBe(true);
    expect(updated.transitioned).toBe(false);
    expect(updated.state.stoppedAt).toEqual(now);
  });

  it('validates until: future and within 30 days', () => {
    expect(() => stopItem(AVAILABLE, { until: new Date(now.getTime() - 1), source: 'manual', now })).toThrow(/future/);
    expect(() => stopItem(AVAILABLE, { until: new Date(now.getTime() + 31 * 24 * hour), source: 'manual', now })).toThrow(/30 days/);
  });

  it('expired stop is effectively available and restorable', () => {
    const stopped = stopItem(AVAILABLE, { until: new Date(now.getTime() + hour), source: 'manual', now }).state;
    const later = new Date(now.getTime() + hour);
    expect(effectiveAvailability(stopped, later)).toBe('available');
    expect(isStopExpired(stopped, later)).toBe(true);
    expect(isStopExpired(stopped, now)).toBe(false);
    // Новый стоп поверх истёкшего — это переход, а не обновление.
    expect(stopItem(stopped, { until: null, source: 'manual', now: later }).transitioned).toBe(true);
  });

  it('restore is idempotent', () => {
    expect(restoreItem(AVAILABLE).changed).toBe(false);
    const stopped = stopItem(AVAILABLE, { until: null, source: 'manual', now }).state;
    const restored = restoreItem(stopped);
    expect(restored.changed).toBe(true);
    expect(restored.state).toEqual(AVAILABLE);
  });

  it('display follows branch stopListMode', () => {
    expect(displayAvailability('available', 'hide')).toBe('available');
    expect(displayAvailability('stopped', 'hide')).toBe('stopped_hidden');
    expect(displayAvailability('stopped', 'mark_unavailable')).toBe('stopped_shown');
  });

  it('end of local day is next midnight in Asia/Almaty', () => {
    expect(endOfLocalDay(now, 'Asia/Almaty').toISOString()).toBe('2026-10-01T19:00:00.000Z');
    // 23:30 по Астане -> полночь через 30 минут.
    expect(endOfLocalDay(new Date('2026-10-01T18:30:00Z'), 'Asia/Almaty').toISOString()).toBe('2026-10-01T19:00:00.000Z');
  });
});
