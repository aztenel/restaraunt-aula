import { describe, expect, it } from 'vitest';
import { providerForBranch } from './routing';
import { isSyncQueued, retryGapMs, shouldAlertSyncFailure, shouldScheduleSync, STOP_LIST_ENQUEUE_STALE_MS } from './sync-policy';

const t0 = new Date('2026-10-01T10:00:00Z');
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

describe('stop-list sync policy', () => {
  it('does not enqueue twice while a job is waiting; a lost job is re-enqueued', () => {
    const state = { enqueuedAt: t0, attemptedAt: null, failures: 0 };
    expect(isSyncQueued(state, at(1))).toBe(true);
    expect(shouldScheduleSync(state, at(1))).toBe(false);
    expect(shouldScheduleSync(state, new Date(t0.getTime() + STOP_LIST_ENQUEUE_STALE_MS))).toBe(true);
    expect(shouldScheduleSync({ enqueuedAt: t0, attemptedAt: at(1), failures: 0 }, at(5))).toBe(true);
  });

  it('backs off exponentially after consecutive failures, capped at one hour', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map((f) => retryGapMs(f) / 60_000)).toEqual([0, 5, 10, 20, 40, 60, 60]);
    // Задача выполнилась через секунду после тика — следующий тик всё равно подходит.
    const once = { enqueuedAt: t0, attemptedAt: new Date(t0.getTime() + 1000), failures: 1 };
    expect(shouldScheduleSync(once, at(5))).toBe(true);
    const twice = { ...once, failures: 2 };
    expect(shouldScheduleSync(twice, at(5))).toBe(false);
    expect(shouldScheduleSync(twice, at(10))).toBe(true);
    const thrice = { ...once, failures: 3 };
    expect(shouldScheduleSync(thrice, at(15))).toBe(false);
    expect(shouldScheduleSync(thrice, at(20))).toBe(true);
  });

  it('alerts once per episode: immediately for permanent errors, after 3 temporary failures', () => {
    expect(shouldAlertSyncFailure({ failures: 1, retryable: false, alreadyAlerted: false })).toBe(true);
    expect(shouldAlertSyncFailure({ failures: 2, retryable: true, alreadyAlerted: false })).toBe(false);
    expect(shouldAlertSyncFailure({ failures: 3, retryable: true, alreadyAlerted: false })).toBe(true);
    expect(shouldAlertSyncFailure({ failures: 7, retryable: true, alreadyAlerted: true })).toBe(false);
  });
});

describe('POS routing', () => {
  it('branch override -> default -> manual', () => {
    expect(providerForBranch(null, 'b1')).toBe('manual');
    expect(providerForBranch({ default: 'manual', branches: { b1: 'pos_a' } }, 'b1')).toBe('pos_a');
    expect(providerForBranch({ default: 'pos_b', branches: { b1: 'pos_a' } }, 'b2')).toBe('pos_b');
    expect(providerForBranch({ default: '', branches: {} }, 'b2')).toBe('manual');
  });
});
