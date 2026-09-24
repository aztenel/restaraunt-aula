import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import {
  assertCapacity,
  capacityFits,
  normalizeHallCode,
  normalizeTypeCode,
  normalizeVenueCode,
  validateCapacity,
  validateDeposit,
  validatePlanSize,
  validatePosition,
} from './venue';

describe('venue capacity', () => {
  it('capacity must be 1..1000 with max >= min', () => {
    expect(() => validateCapacity(2, 4)).not.toThrow();
    expect(() => validateCapacity(0, 4)).toThrow(ValidationError);
    expect(() => validateCapacity(6, 4)).toThrow(ValidationError);
    expect(() => validateCapacity(1, 1001)).toThrow(ValidationError);
  });

  it('booking checks capacity (minimum only for regular reservations)', () => {
    expect(capacityFits(4, 2, 4)).toBe(true);
    expect(capacityFits(5, 2, 4)).toBe(false);
    expect(capacityFits(1, 2, 4)).toBe(false);
    expect(() => assertCapacity(5, 2, 4, { checkMinimum: true })).toThrow(expect.objectContaining({ code: 'reservation.capacity_exceeded' }));
    expect(() => assertCapacity(1, 2, 4, { checkMinimum: true })).toThrow(expect.objectContaining({ code: 'reservation.capacity_below_minimum' }));
    expect(() => assertCapacity(1, 2, 4, { checkMinimum: false })).not.toThrow();
    expect(() => assertCapacity(0, 1, 4, { checkMinimum: false })).toThrow(ValidationError);
  });
});

describe('venue deposit, codes, plan', () => {
  it('deposit is positive or absent', () => {
    expect(validateDeposit(null)).toBeNull();
    expect(validateDeposit(Money.tenge(50_000))?.amount).toBe(5_000_000);
    expect(() => validateDeposit(Money.zero())).toThrow(ValidationError);
  });

  it('codes are normalized', () => {
    expect(normalizeVenueCode(' T12 ')).toBe('T12');
    expect(normalizeHallCode('Main')).toBe('main');
    expect(normalizeTypeCode('VIP_hall')).toBe('vip_hall');
    expect(() => normalizeVenueCode('стол 1')).toThrow(ValidationError);
    expect(() => normalizeTypeCode('1abc')).toThrow(ValidationError);
  });

  it('plan size limits', () => {
    expect(validatePlanSize({ width: 1000, height: 600 })).toEqual({ width: 1000, height: 600 });
    expect(() => validatePlanSize({ width: 50, height: 600 })).toThrow(ValidationError);
  });

  it('position must fit inside the hall plan', () => {
    const plan = { width: 1000, height: 600 };
    expect(validatePosition({ x: 10, y: 20, w: 80, h: 80, shape: 'circle', rotation: 45 }, plan)).toEqual({
      x: 10,
      y: 20,
      w: 80,
      h: 80,
      shape: 'circle',
      rotation: 45,
    });
    expect(() => validatePosition({ x: 950, y: 0, w: 80, h: 80, shape: 'rect', rotation: 0 }, plan)).toThrow(
      expect.objectContaining({ code: 'reservation.position_outside_plan' }),
    );
    expect(() => validatePosition({ x: 0, y: 0, w: 80, h: 80, shape: 'rect', rotation: 360 }, plan)).toThrow(ValidationError);
    expect(() => validatePosition({ x: 0, y: 0, w: 80, h: 80, shape: 'triangle' as 'rect', rotation: 0 }, plan)).toThrow(ValidationError);
  });
});
