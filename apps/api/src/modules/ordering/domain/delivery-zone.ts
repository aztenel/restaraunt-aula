import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { assertGeoPoint, distanceMeters, GeoPoint, GeoPolygon, normalizePolygon, pointInPolygon, polygonsOverlap } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { assertTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { ZoneTerms } from './totals';

/**
 * Зона доставки филиала: полигон на карте, минимальная сумма заказа, стоимость доставки,
 * «бесплатно от суммы», ориентировочное время доставки. Инвариант ТЗ: зоны одного филиала
 * не пересекаются (касание по границе допустимо — зоны рисуются «стык в стык»).
 */
export interface DeliveryZoneDefinition {
  name: Translatable;
  polygon: GeoPolygon;
  minOrderAmount: Money;
  deliveryFee: Money;
  freeDeliveryFrom: Money | null;
  etaMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

export interface DeliveryZoneState extends DeliveryZoneDefinition {
  id: string;
  branchId: string;
}

export const MAX_ZONE_POINTS = 500;

export function validateZoneDefinition(input: DeliveryZoneDefinition): DeliveryZoneDefinition {
  if (input.polygon.length > MAX_ZONE_POINTS) {
    throw new ValidationError('delivery_zone.too_many_points', `Polygon must have at most ${MAX_ZONE_POINTS} points`);
  }
  const polygon = normalizePolygon(input.polygon);
  for (const [field, value] of [
    ['minOrderAmount', input.minOrderAmount],
    ['deliveryFee', input.deliveryFee],
    ['freeDeliveryFrom', input.freeDeliveryFrom],
  ] as const) {
    if (value && value.isNegative()) {
      throw new ValidationError('delivery_zone.negative_amount', `${field} must not be negative`, { field });
    }
  }
  if (!Number.isInteger(input.etaMinutes) || input.etaMinutes < 1 || input.etaMinutes > 600) {
    throw new ValidationError('delivery_zone.invalid_eta', 'etaMinutes must be 1..600');
  }
  return {
    name: assertTranslatable(input.name, 'name'),
    polygon,
    minOrderAmount: input.minOrderAmount,
    deliveryFee: input.deliveryFee,
    freeDeliveryFrom: input.freeDeliveryFrom,
    etaMinutes: input.etaMinutes,
    isActive: input.isActive,
    sortOrder: Number.isInteger(input.sortOrder) ? input.sortOrder : 0,
  };
}

/**
 * Зоны одного филиала не пересекаются. Проверяются все неудалённые зоны филиала (и выключенные тоже:
 * иначе включение зоны нарушило бы инвариант).
 */
export function assertNoOverlap(candidate: { id: string | null; polygon: GeoPolygon }, others: ReadonlyArray<{ id: string; polygon: GeoPolygon }>): void {
  for (const other of others) {
    if (other.id === candidate.id) continue;
    if (polygonsOverlap(candidate.polygon, other.polygon)) {
      throw new ConflictError('delivery_zone.overlap', 'Delivery zones of one branch must not overlap', { conflictingZoneId: other.id });
    }
  }
}

export function zoneTerms(zone: DeliveryZoneState): ZoneTerms {
  return {
    zoneId: zone.id,
    minOrderAmount: zone.minOrderAmount,
    deliveryFee: zone.deliveryFee,
    freeDeliveryFrom: zone.freeDeliveryFrom,
    etaMinutes: zone.etaMinutes,
  };
}

/** Самая выгодная для гостя зона: меньшая стоимость доставки, затем порядок сортировки. */
export function compareZones(a: DeliveryZoneState, b: DeliveryZoneState): number {
  return a.deliveryFee.amount - b.deliveryFee.amount || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id);
}

/** Зона филиала, в которую попадает точка (активные зоны). Касание границы двух зон — выгодная. */
export function findZoneForPoint(point: GeoPoint, zones: readonly DeliveryZoneState[]): DeliveryZoneState | null {
  const p = assertGeoPoint(point);
  const matching = zones.filter((z) => z.isActive && pointInPolygon(p, z.polygon));
  return matching.sort(compareZones)[0] ?? null;
}

export interface DeliveryCandidate {
  zone: DeliveryZoneState;
  branchLocation: GeoPoint;
  branchSortOrder: number;
}

export interface RankedDeliveryCandidate extends DeliveryCandidate {
  distanceMeters: number;
}

/**
 * Выбор филиала по точке доставки (docs/decisions.md): среди зон разных филиалов, содержащих точку,
 * выбирается филиал с меньшей стоимостью доставки, при равенстве — ближайший к точке.
 * Возвращает кандидатов по убыванию выгодности (первый — выбранный), по одному на филиал.
 */
export function rankDeliveryCandidates(point: GeoPoint, candidates: readonly DeliveryCandidate[]): RankedDeliveryCandidate[] {
  const p = assertGeoPoint(point);
  const bestPerBranch = new Map<string, RankedDeliveryCandidate>();
  for (const c of candidates) {
    if (!c.zone.isActive || !pointInPolygon(p, c.zone.polygon)) continue;
    const ranked: RankedDeliveryCandidate = { ...c, distanceMeters: Math.round(distanceMeters(c.branchLocation, p)) };
    const current = bestPerBranch.get(c.zone.branchId);
    if (!current || compareZones(ranked.zone, current.zone) < 0) bestPerBranch.set(c.zone.branchId, ranked);
  }
  return [...bestPerBranch.values()].sort(
    (a, b) =>
      a.zone.deliveryFee.amount - b.zone.deliveryFee.amount ||
      a.distanceMeters - b.distanceMeters ||
      a.branchSortOrder - b.branchSortOrder ||
      a.zone.branchId.localeCompare(b.zone.branchId),
  );
}
