import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';

/**
 * Места и залы: вместимость, депозит, позиция на карте зала.
 * Вместимость проверяется при брони (инвариант модели данных ТЗ).
 */
export const MAX_VENUE_CAPACITY = 1000;

export const VENUE_SHAPES = ['rect', 'circle'] as const;
export type VenueShape = (typeof VENUE_SHAPES)[number];

/** Позиция места на плане зала (условные единицы плана, поворот в градусах). */
export interface VenuePosition {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: VenueShape;
  rotation: number;
}

export interface HallPlanSize {
  width: number;
  height: number;
}

export const PLAN_LIMITS = { min: 100, max: 10_000 } as const;

const VENUE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const HALL_CODE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const TYPE_CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;

export function normalizeVenueCode(code: string): string {
  const value = (code ?? '').trim();
  if (!VENUE_CODE_RE.test(value)) {
    throw new ValidationError('reservation.invalid_venue_code', 'Venue code: latin letters, digits, "-" or "_", up to 32 chars', { code });
  }
  return value;
}

export function normalizeHallCode(code: string): string {
  const value = (code ?? '').trim().toLowerCase();
  if (!HALL_CODE_RE.test(value)) {
    throw new ValidationError('reservation.invalid_hall_code', 'Hall code: lowercase latin letters, digits, "-" or "_"', { code });
  }
  return value;
}

export function normalizeTypeCode(code: string): string {
  const value = (code ?? '').trim().toLowerCase();
  if (!TYPE_CODE_RE.test(value)) {
    throw new ValidationError('reservation.invalid_type_code', 'Venue type code: lowercase latin letters, digits, "_"', { code });
  }
  return value;
}

export function validateCapacity(capacityMin: number, capacityMax: number): void {
  if (!Number.isInteger(capacityMin) || !Number.isInteger(capacityMax) || capacityMin < 1 || capacityMax > MAX_VENUE_CAPACITY) {
    throw new ValidationError('reservation.invalid_capacity', `Capacity must be integers in [1, ${MAX_VENUE_CAPACITY}]`, {
      capacityMin,
      capacityMax,
    });
  }
  if (capacityMax < capacityMin) {
    throw new ValidationError('reservation.invalid_capacity', 'capacityMax must be >= capacityMin', { capacityMin, capacityMax });
  }
}

/** Депозит места: положительная сумма или его нет. */
export function validateDeposit(deposit: Money | null): Money | null {
  if (deposit === null) return null;
  if (!deposit.isPositive()) throw new ValidationError('reservation.invalid_deposit', 'Deposit must be positive or absent');
  return deposit;
}

export function validatePlanSize(size: HallPlanSize): HallPlanSize {
  for (const [key, value] of Object.entries(size)) {
    if (!Number.isInteger(value) || value < PLAN_LIMITS.min || value > PLAN_LIMITS.max) {
      throw new ValidationError('reservation.invalid_plan_size', `Plan ${key} must be an integer in [${PLAN_LIMITS.min}, ${PLAN_LIMITS.max}]`, {
        key,
        value,
      });
    }
  }
  return size;
}

/** Место целиком внутри плана зала, размеры положительные, поворот 0..359. */
export function validatePosition(position: VenuePosition, plan: HallPlanSize): VenuePosition {
  const { x, y, w, h, rotation, shape } = position;
  if (![x, y, w, h, rotation].every((v) => Number.isInteger(v))) {
    throw new ValidationError('reservation.invalid_position', 'Position values must be integers');
  }
  if (!(VENUE_SHAPES as readonly string[]).includes(shape)) {
    throw new ValidationError('reservation.invalid_position', 'Shape must be rect or circle', { shape });
  }
  if (x < 0 || y < 0 || w < 1 || h < 1 || x + w > plan.width || y + h > plan.height) {
    throw new ValidationError('reservation.position_outside_plan', 'Venue must fit inside the hall plan', { position, plan });
  }
  if (rotation < 0 || rotation > 359) {
    throw new ValidationError('reservation.invalid_position', 'Rotation must be in [0, 359]', { rotation });
  }
  return { x, y, w, h, shape, rotation };
}

export function capacityFits(guests: number, capacityMin: number, capacityMax: number): boolean {
  return Number.isInteger(guests) && guests >= capacityMin && guests <= capacityMax;
}

/**
 * Проверка вместимости при брони. Для банкетов проверяется только верхняя граница
 * (контракт VenueAvailability: ValidationError при превышении вместимости).
 */
export function assertCapacity(guests: number, capacityMin: number, capacityMax: number, options: { checkMinimum: boolean }): void {
  if (!Number.isInteger(guests) || guests < 1) {
    throw new ValidationError('reservation.invalid_guests', 'Guests must be a positive integer', { guests });
  }
  if (guests > capacityMax) {
    throw new ValidationError('reservation.capacity_exceeded', 'Too many guests for this venue', { guests, capacityMax });
  }
  if (options.checkMinimum && guests < capacityMin) {
    throw new ValidationError('reservation.capacity_below_minimum', 'Too few guests for this venue', { guests, capacityMin });
  }
}
