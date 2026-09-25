import { describe, expect, it } from 'vitest';
import { reminderAt, reminderDue } from './reminder';

const start = new Date('2026-10-25T14:00:00Z');

describe('reservation reminder', () => {
  it('is N hours before the start and only in the future', () => {
    expect(reminderAt(start, 3, new Date('2026-10-24T10:00:00Z'))?.toISOString()).toBe('2026-10-25T11:00:00.000Z');
    expect(reminderAt(start, 3, new Date('2026-10-25T12:00:00Z'))).toBeNull();
    expect(reminderAt(start, 0, new Date('2026-10-24T10:00:00Z'))).toBeNull();
  });

  it('is sent only for a still confirmed, not moved, not yet reminded reservation', () => {
    const base = { status: 'confirmed', start, scheduledStart: start.toISOString(), reminderSentAt: null, now: new Date('2026-10-25T11:00:00Z') };
    expect(reminderDue(base)).toBe(true);
    expect(reminderDue({ ...base, status: 'cancelled' })).toBe(false);
    expect(reminderDue({ ...base, scheduledStart: '2026-10-24T14:00:00.000Z' })).toBe(false);
    expect(reminderDue({ ...base, reminderSentAt: new Date() })).toBe(false);
    expect(reminderDue({ ...base, now: start })).toBe(false);
  });
});
