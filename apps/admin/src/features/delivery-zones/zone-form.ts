/**
 * Зона доставки: форма ⇄ API. Полигон — кольцо точек { lat, lng } без замыкающей точки (сервер тоже
 * её убирает), координаты округляются до 6 знаков (~10 см). Суммы — целые тиыны (MoneyInput).
 * Пересечение зон и самопересечение полигона проверяет сервер (delivery_zone.overlap, geo.*).
 */
import type { GeoPoint, Money, Translatable } from '@aula/api-client';

export interface DeliveryZone {
  id: string;
  branchId: string;
  name: Translatable;
  polygon: GeoPoint[];
  minOrderAmount: Money;
  deliveryFee: Money;
  freeDeliveryFrom: Money | null;
  etaMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

interface MoneyInput {
  amount: number;
  currency: 'KZT';
}

/** PUT /admin/delivery-zones/{id} */
export interface DeliveryZoneInput {
  name: Translatable;
  polygon: GeoPoint[];
  minOrderAmount: MoneyInput;
  deliveryFee: MoneyInput;
  freeDeliveryFrom: MoneyInput | null;
  etaMinutes: number;
  isActive: boolean;
  sortOrder: number;
}

/** POST /admin/delivery-zones */
export interface CreateDeliveryZoneInput extends DeliveryZoneInput {
  branchId: string;
}

export interface ZoneFormValues {
  name: Translatable;
  /** Тиыны. */
  minOrderAmount: number | null;
  deliveryFee: number | null;
  /** null — бесплатной доставки от суммы нет. */
  freeDeliveryFrom: number | null;
  etaMinutes: number | null;
  isActive: boolean;
  sortOrder: number | null;
}

export const MIN_ZONE_POINTS = 3;
export const MAX_ZONE_POINTS = 500;
export const MAX_ETA_MINUTES = 600;
const COORD_FACTOR = 1_000_000;

export const EMPTY_ZONE_FORM: ZoneFormValues = {
  name: {},
  minOrderAmount: 0,
  deliveryFee: 0,
  freeDeliveryFrom: null,
  etaMinutes: 60,
  isActive: true,
  sortOrder: 0,
};

export function roundCoord(value: number): number {
  return Math.round(value * COORD_FACTOR) / COORD_FACTOR;
}

function isLatLng(value: unknown): value is { lat: number; lng: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { lat?: unknown }).lat === 'number' &&
    typeof (value as { lng?: unknown }).lng === 'number'
  );
}

function samePoint(a: GeoPoint, b: GeoPoint): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * Результат Leaflet `polygon.getLatLngs()` (LatLng[] | LatLng[][] | LatLng[][][]) → внешнее кольцо.
 * Повторы подряд и замыкающая точка убираются, координаты округляются.
 */
export function latLngsToPolygon(latlngs: unknown): GeoPoint[] {
  let ring: unknown = latlngs;
  while (Array.isArray(ring) && ring.length > 0 && Array.isArray(ring[0])) ring = ring[0];
  if (!Array.isArray(ring)) return [];
  const points: GeoPoint[] = [];
  for (const raw of ring) {
    if (!isLatLng(raw)) continue;
    const point = { lat: roundCoord(raw.lat), lng: roundCoord(raw.lng) };
    const previous = points[points.length - 1];
    if (!previous || !samePoint(previous, point)) points.push(point);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && first && last && samePoint(first, last)) points.pop();
  return points;
}

/** Полигон API → позиции для Leaflet ([lat, lng]). */
export function polygonToLatLngs(polygon: readonly GeoPoint[]): Array<[number, number]> {
  return polygon.map((p) => [p.lat, p.lng]);
}

export function zoneToFormValues(zone: DeliveryZone): ZoneFormValues {
  return {
    name: { ...zone.name },
    minOrderAmount: zone.minOrderAmount.amount,
    deliveryFee: zone.deliveryFee.amount,
    freeDeliveryFrom: zone.freeDeliveryFrom?.amount ?? null,
    etaMinutes: zone.etaMinutes,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
  };
}

export type ZoneFormIssue =
  | 'polygon_required'
  | 'polygon_too_many_points'
  | 'name_required'
  | 'amount_required'
  | 'amount_negative'
  | 'eta_invalid';

export type ZoneFormErrors = Partial<Record<'polygon' | 'name' | 'minOrderAmount' | 'deliveryFee' | 'freeDeliveryFrom' | 'etaMinutes', ZoneFormIssue>>;

function checkAmount(value: number | null, required: boolean): ZoneFormIssue | undefined {
  if (value === null || value === undefined) return required ? 'amount_required' : undefined;
  if (value < 0) return 'amount_negative';
  return undefined;
}

/** Проверка до отправки (то же правило, что на сервере: DeliveryZoneInputDto и validateZoneDefinition). */
export function validateZoneForm(values: ZoneFormValues, polygon: readonly GeoPoint[]): ZoneFormErrors {
  const errors: ZoneFormErrors = {};
  if (polygon.length < MIN_ZONE_POINTS) errors.polygon = 'polygon_required';
  else if (polygon.length > MAX_ZONE_POINTS) errors.polygon = 'polygon_too_many_points';
  if (!values.name.kk?.trim() && !values.name.ru?.trim()) errors.name = 'name_required';
  const min = checkAmount(values.minOrderAmount, true);
  if (min) errors.minOrderAmount = min;
  const fee = checkAmount(values.deliveryFee, true);
  if (fee) errors.deliveryFee = fee;
  const free = checkAmount(values.freeDeliveryFrom, false);
  if (free) errors.freeDeliveryFrom = free;
  const eta = values.etaMinutes;
  if (eta === null || !Number.isInteger(eta) || eta < 1 || eta > MAX_ETA_MINUTES) errors.etaMinutes = 'eta_invalid';
  return errors;
}

function money(amount: number): MoneyInput {
  return { amount, currency: 'KZT' };
}

function cleanTranslatable(value: Translatable): Translatable {
  const result: Translatable = {};
  for (const [locale, text] of Object.entries(value) as Array<[keyof Translatable, string | undefined]>) {
    const trimmed = text?.trim();
    if (trimmed) result[locale] = trimmed;
  }
  return result;
}

/** Форма + полигон → тело PUT. Вызывать после validateZoneForm. */
export function formValuesToZoneInput(values: ZoneFormValues, polygon: readonly GeoPoint[]): DeliveryZoneInput {
  return {
    name: cleanTranslatable(values.name),
    polygon: polygon.map((p) => ({ lat: roundCoord(p.lat), lng: roundCoord(p.lng) })),
    minOrderAmount: money(values.minOrderAmount ?? 0),
    deliveryFee: money(values.deliveryFee ?? 0),
    freeDeliveryFrom: values.freeDeliveryFrom === null || values.freeDeliveryFrom === undefined ? null : money(values.freeDeliveryFrom),
    etaMinutes: values.etaMinutes ?? 0,
    isActive: values.isActive,
    sortOrder: values.sortOrder ?? 0,
  };
}

/** Форма + полигон → тело POST (новая зона филиала). */
export function formValuesToCreateInput(branchId: string, values: ZoneFormValues, polygon: readonly GeoPoint[]): CreateDeliveryZoneInput {
  return { ...formValuesToZoneInput(values, polygon), branchId };
}

/** Прямоугольная заготовка зоны вокруг точки (для ввода без рисования): ±dLat/±dLng. */
export function rectangleAround(center: GeoPoint, dLat = 0.01, dLng = 0.015): GeoPoint[] {
  return [
    { lat: roundCoord(center.lat + dLat), lng: roundCoord(center.lng - dLng) },
    { lat: roundCoord(center.lat + dLat), lng: roundCoord(center.lng + dLng) },
    { lat: roundCoord(center.lat - dLat), lng: roundCoord(center.lng + dLng) },
    { lat: roundCoord(center.lat - dLat), lng: roundCoord(center.lng - dLng) },
  ];
}
