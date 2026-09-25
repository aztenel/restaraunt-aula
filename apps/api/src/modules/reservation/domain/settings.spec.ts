import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { DEFAULT_RESERVATION_SETTINGS, mergeSettings, validateSettings } from './settings';

describe('reservation settings', () => {
  it('defaults: reminder 3 hours before, 60 minutes lead time, 60 days ahead', () => {
    expect(DEFAULT_RESERVATION_SETTINGS).toMatchObject({ reminderHoursBefore: 3, minLeadMinutes: 60, maxDaysAhead: 60 });
    expect(validateSettings(DEFAULT_RESERVATION_SETTINGS)).toEqual(DEFAULT_RESERVATION_SETTINGS);
  });

  it('merge applies only provided values and validates the result', () => {
    const merged = mergeSettings(DEFAULT_RESERVATION_SETTINGS, { reminderHoursBefore: 24, policyText: { ru: '  Правила  ', de: 'x' } as never });
    expect(merged).toEqual({ ...DEFAULT_RESERVATION_SETTINGS, reminderHoursBefore: 24, policyText: { ru: 'Правила' } });
    expect(mergeSettings(merged, { minLeadMinutes: undefined })).toEqual(merged);
  });

  it('rejects values out of range', () => {
    expect(() => mergeSettings(DEFAULT_RESERVATION_SETTINGS, { reminderHoursBefore: 100 })).toThrow(ValidationError);
    expect(() => mergeSettings(DEFAULT_RESERVATION_SETTINGS, { maxDaysAhead: 0 })).toThrow(ValidationError);
    expect(() => mergeSettings(DEFAULT_RESERVATION_SETTINGS, { minLeadMinutes: 1.5 })).toThrow(
      expect.objectContaining({ code: 'reservation.invalid_setting' }),
    );
  });
});
