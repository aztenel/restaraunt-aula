import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../shared/kernel/errors';
import { GeoPolygon } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { assertNoOverlap, DeliveryZoneState, findZoneForPoint, rankDeliveryCandidates, validateZoneDefinition } from './delivery-zone';

const square = (lat: number, lng: number, d: number): GeoPolygon => [
  { lat: lat - d, lng: lng - d },
  { lat: lat - d, lng: lng + d },
  { lat: lat + d, lng: lng + d },
  { lat: lat + d, lng: lng - d },
];

function zone(id: string, branchId: string, polygon: GeoPolygon, fee: number, overrides: Partial<DeliveryZoneState> = {}): DeliveryZoneState {
  return {
    id,
    branchId,
    name: { ru: id },
    polygon,
    minOrderAmount: Money.tenge(3000),
    deliveryFee: Money.tenge(fee),
    freeDeliveryFrom: null,
    etaMinutes: 45,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

describe('delivery zones', () => {
  it('validates the definition', () => {
    const def = validateZoneDefinition({
      name: { ru: ' Ближняя ' },
      polygon: [...square(51, 71, 0.01), { lat: 50.99, lng: 70.99 }],
      minOrderAmount: Money.tenge(3000),
      deliveryFee: Money.tenge(500),
      freeDeliveryFrom: null,
      etaMinutes: 45,
      isActive: true,
      sortOrder: 1,
    });
    expect(def.polygon).toHaveLength(4); // замыкающая точка убрана
    expect(def.name.ru).toBe('Ближняя');
    expect(() =>
      validateZoneDefinition({ ...def, polygon: [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }] }),
    ).toThrow(expect.objectContaining({ code: 'geo.polygon_too_small' }));
    expect(() => validateZoneDefinition({ ...def, deliveryFee: Money.of(-1) })).toThrow(
      expect.objectContaining({ code: 'delivery_zone.negative_amount' }),
    );
    expect(() => validateZoneDefinition({ ...def, etaMinutes: 0 })).toThrow(expect.objectContaining({ code: 'delivery_zone.invalid_eta' }));
    expect(() => validateZoneDefinition({ ...def, name: {} })).toThrow(expect.objectContaining({ code: 'translatable.required' }));
  });

  it('zones of one branch must not overlap, touching is allowed', () => {
    const a = { id: 'a', polygon: square(51, 71, 0.01) };
    const overlapping = { id: null, polygon: square(51.005, 71.005, 0.01) };
    const touching = { id: null, polygon: square(51.02, 71, 0.01) };
    expect(() => assertNoOverlap(overlapping, [a])).toThrow(ConflictError);
    expect(() => assertNoOverlap(overlapping, [a])).toThrow(expect.objectContaining({ code: 'delivery_zone.overlap' }));
    expect(() => assertNoOverlap(touching, [a])).not.toThrow();
    // Сама с собой при обновлении не конфликтует.
    expect(() => assertNoOverlap({ id: 'a', polygon: square(51, 71, 0.02) }, [a])).not.toThrow();
  });

  it('finds the zone containing a point (inactive zones ignored)', () => {
    const zones = [zone('near', 'b1', square(51, 71, 0.01), 500), zone('off', 'b1', square(51.1, 71, 0.01), 100, { isActive: false })];
    expect(findZoneForPoint({ lat: 51.001, lng: 71.001 }, zones)?.id).toBe('near');
    expect(findZoneForPoint({ lat: 51.1, lng: 71 }, zones)).toBeNull();
  });

  it('chooses the branch with the lowest fee, then the nearest', () => {
    const point = { lat: 51.0, lng: 71.0 };
    const cheapFar = { zone: zone('z1', 'far', square(51, 71, 0.05), 400), branchLocation: { lat: 51.04, lng: 71.0 }, branchSortOrder: 1 };
    const expensiveNear = { zone: zone('z2', 'near', square(51, 71, 0.05), 800), branchLocation: { lat: 51.001, lng: 71.0 }, branchSortOrder: 2 };
    const ranked = rankDeliveryCandidates(point, [expensiveNear, cheapFar]);
    expect(ranked.map((r) => r.zone.branchId)).toEqual(['far', 'near']);

    const sameFeeNear = { ...expensiveNear, zone: zone('z3', 'near', square(51, 71, 0.05), 400) };
    expect(rankDeliveryCandidates(point, [cheapFar, sameFeeNear])[0]!.zone.branchId).toBe('near');
    expect(rankDeliveryCandidates(point, [cheapFar, sameFeeNear])[0]!.distanceMeters).toBeLessThan(200);
  });

  it('keeps the best zone per branch and ignores zones not containing the point', () => {
    const point = { lat: 51.0, lng: 71.0 };
    const ranked = rankDeliveryCandidates(point, [
      { zone: zone('a', 'b1', square(51, 71, 0.05), 900), branchLocation: point, branchSortOrder: 0 },
      { zone: zone('b', 'b1', square(51, 71, 0.01), 500), branchLocation: point, branchSortOrder: 0 },
      { zone: zone('c', 'b2', square(52, 72, 0.01), 100), branchLocation: point, branchSortOrder: 0 },
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.zone.id).toBe('b');
  });
});
