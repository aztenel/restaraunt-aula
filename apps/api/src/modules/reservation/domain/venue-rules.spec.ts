import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { effectiveRules, validateOverrides, validateRules, VenueRules } from './venue-rules';

const VIP: VenueRules = {
  durationMinutes: 180,
  holdMinutes: 30,
  cancellationDeadlineHours: 24,
  requiresManualConfirmation: false,
  cleanupMinutes: 30,
  slotStepMinutes: 30,
  bookableOnline: true,
};

describe('venue rules', () => {
  it('validates a full rule set', () => {
    expect(validateRules(VIP)).toEqual(VIP);
    expect(() => validateRules({ ...VIP, durationMinutes: 10 })).toThrow(ValidationError);
    expect(() => validateRules({ ...VIP, holdMinutes: 0 })).toThrow(ValidationError);
    expect(() => validateRules({ ...VIP, cleanupMinutes: 1.5 })).toThrow(ValidationError);
    expect(() => validateRules({ ...VIP, bookableOnline: 'yes' as unknown as boolean })).toThrow(ValidationError);
  });

  it('overrides: only known keys, nulls mean "inherit from type"', () => {
    expect(validateOverrides({ cancellationDeadlineHours: 48, cleanupMinutes: null })).toEqual({ cancellationDeadlineHours: 48 });
    expect(validateOverrides(null)).toEqual({});
    expect(() => validateOverrides({ depositPercent: 10 })).toThrow(ValidationError);
    expect(() => validateOverrides({ slotStepMinutes: 1 })).toThrow(ValidationError);
  });

  it('effective rules = type defaults + venue overrides', () => {
    const rules = effectiveRules(VIP, { cancellationDeadlineHours: 48, bookableOnline: false });
    expect(rules).toEqual({ ...VIP, cancellationDeadlineHours: 48, bookableOnline: false });
    expect(effectiveRules(VIP, {})).toEqual(VIP);
  });

  it('validation error carries the rule key', () => {
    try {
      validateRules({ ...VIP, slotStepMinutes: 500 });
    } catch (err) {
      expect((err as ValidationError).code).toBe('reservation.invalid_rule');
      expect((err as ValidationError).details).toMatchObject({ key: 'slotStepMinutes' });
    }
  });
});
