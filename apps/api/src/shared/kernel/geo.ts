import { ValidationError } from './errors';

/**
 * Геометрия зон доставки. PostGIS не требуется: полигоны хранятся как массив точек (JSONB),
 * попадание точки и пересечение полигонов считаются здесь.
 */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Кольцо полигона без повторения первой точки в конце. */
export type GeoPolygon = GeoPoint[];

export function assertGeoPoint(p: GeoPoint): GeoPoint {
  if (
    typeof p?.lat !== 'number' ||
    typeof p?.lng !== 'number' ||
    !Number.isFinite(p.lat) ||
    !Number.isFinite(p.lng) ||
    Math.abs(p.lat) > 90 ||
    Math.abs(p.lng) > 180
  ) {
    throw new ValidationError('geo.invalid_point', 'Invalid coordinates', { point: p });
  }
  return { lat: p.lat, lng: p.lng };
}

export function normalizePolygon(points: GeoPoint[]): GeoPolygon {
  const ring = points.map(assertGeoPoint);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (ring.length > 1 && first && last && first.lat === last.lat && first.lng === last.lng) {
    ring.pop();
  }
  if (ring.length < 3) {
    throw new ValidationError('geo.polygon_too_small', 'Polygon must have at least 3 distinct points');
  }
  if (isSelfIntersecting(ring)) {
    throw new ValidationError('geo.polygon_self_intersecting', 'Polygon edges must not intersect each other');
  }
  return ring;
}

/** Ray casting. Точка на границе считается внутри. */
export function pointInPolygon(point: GeoPoint, polygon: GeoPolygon): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (onSegment(a, b, point)) return true;
    const intersects =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersects) inside = !inside;
  }
  return inside;
}

function cross(o: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  return (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);
}

const EPS = 1e-12;

function onSegment(a: GeoPoint, b: GeoPoint, p: GeoPoint): boolean {
  if (Math.abs(cross(a, b, p)) > EPS) return false;
  return (
    Math.min(a.lng, b.lng) - EPS <= p.lng &&
    p.lng <= Math.max(a.lng, b.lng) + EPS &&
    Math.min(a.lat, b.lat) - EPS <= p.lat &&
    p.lat <= Math.max(a.lat, b.lat) + EPS
  );
}

/** Собственное (не касательное в общей вершине) пересечение отрезков. */
function segmentsProperlyIntersect(p1: GeoPoint, p2: GeoPoint, p3: GeoPoint, p4: GeoPoint): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS));
}

function edges(poly: GeoPolygon): Array<[GeoPoint, GeoPoint]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [GeoPoint, GeoPoint]);
}

export function isSelfIntersecting(poly: GeoPolygon): boolean {
  const e = edges(poly);
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      if (j === i + 1 || (i === 0 && j === e.length - 1)) continue; // соседние рёбра
      if (segmentsProperlyIntersect(e[i]![0], e[i]![1], e[j]![0], e[j]![1])) return true;
    }
  }
  return false;
}

/**
 * Пересекаются ли полигоны по площади. Касание по границе пересечением не считается —
 * так зоны можно рисовать «стык в стык».
 */
export function polygonsOverlap(a: GeoPolygon, b: GeoPolygon): boolean {
  for (const [p1, p2] of edges(a)) {
    for (const [p3, p4] of edges(b)) {
      if (segmentsProperlyIntersect(p1, p2, p3, p4)) return true;
    }
  }
  // Одна внутри другой: проверяем центры рёбер и вершины строго внутри.
  const strictlyInside = (p: GeoPoint, poly: GeoPolygon) =>
    pointInPolygon(p, poly) && !edges(poly).some(([x, y]) => onSegment(x, y, p));
  const midpoints = (poly: GeoPolygon) =>
    edges(poly).map(([x, y]) => ({ lat: (x.lat + y.lat) / 2, lng: (x.lng + y.lng) / 2 }));
  if ([...a, ...midpoints(a)].some((p) => strictlyInside(p, b))) return true;
  if ([...b, ...midpoints(b)].some((p) => strictlyInside(p, a))) return true;
  // Совпадающие полигоны: центроид внутри обоих.
  const centroid = (poly: GeoPolygon) => ({
    lat: poly.reduce((s, p) => s + p.lat, 0) / poly.length,
    lng: poly.reduce((s, p) => s + p.lng, 0) / poly.length,
  });
  const ca = centroid(a);
  return strictlyInside(ca, a) && strictlyInside(ca, b);
}

/** Расстояние по большому кругу, метры. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
