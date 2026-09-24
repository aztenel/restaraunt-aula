import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError, InvariantViolationError } from '../../../shared/kernel/errors';
import { CONFIRM_MAX_CHECKS, ORDER_EXPORT_MACHINE, OrderExport, PUSH_MAX_ATTEMPTS } from './order-export';

const now = new Date('2026-10-01T10:00:00Z');

function fresh() {
  return OrderExport.create({ id: 'e1', orderId: 'o1', orderNumber: 'GL-2026-000001', branchId: 'b1', provider: 'manual', now });
}

describe('OrderExport', () => {
  it('state machine: pending -> sent|failed|skipped; failed/skipped -> pending; sent -> failed only (async rejection)', () => {
    expect(ORDER_EXPORT_MACHINE.allowedFrom('pending')).toEqual(['sent', 'failed', 'skipped']);
    expect(ORDER_EXPORT_MACHINE.canTransition('failed', 'pending')).toBe(true);
    expect(ORDER_EXPORT_MACHINE.canTransition('skipped', 'pending')).toBe(true);
    expect(ORDER_EXPORT_MACHINE.allowedFrom('sent')).toEqual(['failed']);
    expect(ORDER_EXPORT_MACHINE.canTransition('sent', 'pending')).toBe(false);
    expect(ORDER_EXPORT_MACHINE.canTransition('failed', 'sent')).toBe(false);
  });

  it('marks sent with POS order id and clears errors', () => {
    const e = fresh();
    e.startAttempt(now);
    expect(e.recordTemporaryFailure('HTTP 503', now)).toBe('retry');
    e.startAttempt(now);
    e.markSent('pos-1', now);
    const s = e.snapshot();
    expect(s.status).toBe('sent');
    expect(s.posOrderId).toBe('pos-1');
    expect(s.attempts).toBe(2);
    expect(s.lastError).toBeNull();
    expect(s.confirmedAt).toEqual(now);
    expect(e.needsConfirmation()).toBe(false);
    expect(e.canRetry()).toBe(false);
    expect(() => e.markSkipped('order_cancelled', now)).toThrow(InvalidStateTransitionError);
    expect(() => e.retry()).toThrow(InvalidStateTransitionError);
    expect(() => e.recordConfirmation({ state: 'created' }, now)).toThrow(InvariantViolationError);
  });

  it('asynchronously created order: confirmed later, or rejected (sent -> failed), or given up after max checks', () => {
    const confirmed = fresh();
    confirmed.startAttempt(now);
    confirmed.markSent('pos-1', now, false);
    expect(confirmed.needsConfirmation()).toBe(true);
    expect(confirmed.recordConfirmation({ state: 'in_progress' }, now)).toBe('wait');
    const later = new Date(now.getTime() + 60_000);
    expect(confirmed.recordConfirmation({ state: 'created' }, later)).toBe('confirmed');
    expect(confirmed.snapshot()).toMatchObject({ status: 'sent', confirmedAt: later, confirmChecks: 2 });

    const rejected = fresh();
    rejected.startAttempt(now);
    rejected.markSent('pos-2', now, false);
    expect(rejected.recordConfirmation({ state: 'failed', error: 'Terminal is offline' }, now)).toBe('rejected');
    expect(rejected.snapshot()).toMatchObject({ status: 'failed', failureReason: 'rejected', lastError: 'Terminal is offline' });
    expect(rejected.canRetry()).toBe(true);
    rejected.retry();
    expect(rejected.snapshot()).toMatchObject({ status: 'pending', confirmedAt: null, confirmChecks: 0 });

    const silent = fresh();
    silent.startAttempt(now);
    silent.markSent('pos-3', now, false);
    for (let i = 1; i < CONFIRM_MAX_CHECKS; i++) expect(silent.recordConfirmation({ state: 'in_progress', error: 'HTTP 503' }, now)).toBe('wait');
    expect(silent.recordConfirmation({ state: 'in_progress' }, now)).toBe('gave_up');
    expect(silent.snapshot()).toMatchObject({ status: 'sent', confirmedAt: null, lastError: 'HTTP 503' });
  });

  it('requires a POS order id', () => {
    const e = fresh();
    expect(() => e.markSent('  ', now)).toThrow(InvariantViolationError);
  });

  it('temporary failures retry until attempts are exhausted', () => {
    const e = fresh();
    for (let i = 1; i < PUSH_MAX_ATTEMPTS; i++) {
      e.startAttempt(now);
      expect(e.recordTemporaryFailure(`HTTP 502 #${i}`, now)).toBe('retry');
      expect(e.status).toBe('pending');
    }
    e.startAttempt(now);
    expect(e.recordTemporaryFailure('HTTP 502 last', now)).toBe('exhausted');
    const s = e.snapshot();
    expect(s.status).toBe('failed');
    expect(s.failureReason).toBe('retries_exhausted');
    expect(s.lastError).toBe('HTTP 502 last');
    expect(s.failedAt).toEqual(now);
  });

  it('non-retryable failure keeps details; manual retry starts a new cycle', () => {
    const e = fresh();
    e.startAttempt(now);
    e.markFailed('missing_mapping', 'Нет сопоставления', now, {
      missing: [{ dishId: 'd1', dishName: 'Плов', dishMissing: true, options: [] }],
    });
    expect(e.snapshot().details.missing).toHaveLength(1);
    expect(e.canRetry()).toBe(true);
    e.retry();
    const s = e.snapshot();
    expect(s.status).toBe('pending');
    expect(s.attempts).toBe(0);
    expect(s.manualRetries).toBe(1);
    expect(s.failureReason).toBeNull();
    expect(s.details).toEqual({});
  });

  it('skips and allows retry of a skipped export', () => {
    const e = fresh();
    e.markSkipped('manual_provider', now);
    expect(e.snapshot().skipReason).toBe('manual_provider');
    expect(e.canRetry()).toBe(true);
    e.retry();
    expect(e.snapshot().skipReason).toBeNull();
  });

  it('provider and attempts change only while pending', () => {
    const e = fresh();
    e.useProvider('other');
    expect(e.snapshot().provider).toBe('other');
    e.markSkipped('order_cancelled', now);
    expect(() => e.useProvider('manual')).toThrow(InvariantViolationError);
    expect(() => e.startAttempt(now)).toThrow(InvariantViolationError);
    expect(() => e.recordTemporaryFailure('x', now)).toThrow(InvariantViolationError);
  });

  it('clips very long errors', () => {
    const e = fresh();
    e.startAttempt(now);
    e.markFailed('rejected', 'x'.repeat(5000), now);
    expect(e.snapshot().lastError!.length).toBeLessThanOrEqual(2000);
  });
});
