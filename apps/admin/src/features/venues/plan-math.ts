/**
 * Математика плана зала — чистые функции (без DOM): перевод координат экрана в единицы плана
 * (SVG с viewBox и preserveAspectRatio «xMidYMid meet»), перетаскивание и изменение размера места
 * с привязкой к сетке и удержанием внутри плана, поворот. Позиции — целые числа (так их хранит сервер:
 * место целиком внутри плана по неповёрнутому прямоугольнику, поворот 0..359).
 */
import type { VenuePosition } from './types';

export interface PlanSize {
  width: number;
  height: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** Минимальный размер места на плане (единиц). */
export const MIN_VENUE_SIZE = 10;

/**
 * Масштаб и отступы вписанного плана («meet»): план целиком виден, пропорции сохраняются,
 * лишнее место по одной из осей — поля по краям.
 */
export function planViewport(rect: Pick<ScreenRect, 'width' | 'height'>, plan: PlanSize): { scale: number; offsetX: number; offsetY: number } {
  if (plan.width <= 0 || plan.height <= 0 || rect.width <= 0 || rect.height <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.min(rect.width / plan.width, rect.height / plan.height);
  return { scale, offsetX: (rect.width - plan.width * scale) / 2, offsetY: (rect.height - plan.height * scale) / 2 };
}

/** Точка экрана (clientX/clientY) → единицы плана. */
export function clientToPlan(client: Point, rect: ScreenRect, plan: PlanSize): Point {
  const { scale, offsetX, offsetY } = planViewport(rect, plan);
  return { x: (client.x - rect.left - offsetX) / scale, y: (client.y - rect.top - offsetY) / scale };
}

/** Смещение указателя в пикселях → смещение в единицах плана. */
export function screenDeltaToPlan(dx: number, dy: number, rect: Pick<ScreenRect, 'width' | 'height'>, plan: PlanSize): Point {
  const { scale } = planViewport(rect, plan);
  return { x: dx / scale, y: dy / scale };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Привязка к сетке (grid ≤ 1 — только округление до целого). */
export function snap(value: number, grid: number): number {
  if (grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

/** Перетаскивание: новая позиция от исходной (на момент нажатия) и смещения; место не выходит за план. */
export function moveVenue(origin: VenuePosition, delta: Point, plan: PlanSize, grid = 1): VenuePosition {
  const maxX = Math.max(0, plan.width - origin.w);
  const maxY = Math.max(0, plan.height - origin.h);
  return {
    ...origin,
    x: clamp(snap(origin.x + delta.x, grid), 0, maxX),
    y: clamp(snap(origin.y + delta.y, grid), 0, maxY),
  };
}

/**
 * Изменение размера за правый нижний угол: левый верхний угол на месте, размер не меньше MIN_VENUE_SIZE
 * и не выходит за план. keepSquare — для круглых мест (w = h).
 */
export function resizeVenue(origin: VenuePosition, delta: Point, plan: PlanSize, grid = 1, keepSquare = false): VenuePosition {
  const maxW = Math.max(MIN_VENUE_SIZE, plan.width - origin.x);
  const maxH = Math.max(MIN_VENUE_SIZE, plan.height - origin.y);
  let w = clamp(snap(origin.w + delta.x, grid), MIN_VENUE_SIZE, maxW);
  let h = clamp(snap(origin.h + delta.y, grid), MIN_VENUE_SIZE, maxH);
  if (keepSquare) {
    const side = clamp(Math.max(w, h), MIN_VENUE_SIZE, Math.min(maxW, maxH));
    w = side;
    h = side;
  }
  return { ...origin, w, h };
}

/** Поворот к диапазону 0..359 (целые градусы). */
export function normalizeRotation(degrees: number): number {
  const value = Math.round(degrees) % 360;
  return value < 0 ? value + 360 : value;
}

/** Угол от центра места к указателю (для ручки поворота), градусы 0..359; 0 — указатель сверху. */
export function rotationFromPointer(position: VenuePosition, pointer: Point, step = 1): number {
  const cx = position.x + position.w / 2;
  const cy = position.y + position.h / 2;
  const degrees = (Math.atan2(pointer.x - cx, -(pointer.y - cy)) * 180) / Math.PI;
  const snapped = step > 1 ? Math.round(degrees / step) * step : degrees;
  return normalizeRotation(snapped);
}

/** Привести позицию к плану (после уменьшения плана или ввода чисел): целые, размеры ≥ 1, внутри плана. */
export function fitToPlan(position: VenuePosition, plan: PlanSize): VenuePosition {
  const w = clamp(Math.round(position.w), 1, plan.width);
  const h = clamp(Math.round(position.h), 1, plan.height);
  return {
    ...position,
    w,
    h,
    x: clamp(Math.round(position.x), 0, plan.width - w),
    y: clamp(Math.round(position.y), 0, plan.height - h),
    rotation: normalizeRotation(position.rotation),
  };
}

/** Место целиком внутри плана (как проверяет сервер: reservation.position_outside_plan). */
export function insidePlan(position: VenuePosition, plan: PlanSize): boolean {
  return position.x >= 0 && position.y >= 0 && position.w >= 1 && position.h >= 1 && position.x + position.w <= plan.width && position.y + position.h <= plan.height;
}

/** Свёрнутые правки плана: id места → новая позиция (только отличающиеся от сервера). */
export function changedPositions(
  original: ReadonlyArray<{ id: string; position: VenuePosition }>,
  draft: ReadonlyMap<string, VenuePosition>,
): Array<{ id: string; position: VenuePosition }> {
  const result: Array<{ id: string; position: VenuePosition }> = [];
  for (const venue of original) {
    const next = draft.get(venue.id);
    if (!next) continue;
    const p = venue.position;
    if (p.x !== next.x || p.y !== next.y || p.w !== next.w || p.h !== next.h || p.shape !== next.shape || p.rotation !== next.rotation) {
      result.push({ id: venue.id, position: next });
    }
  }
  return result;
}

/** Позиция для нового места: левый верхний свободный угол по сетке (не пересекается с другими местами). */
export function freeSpot(existing: readonly VenuePosition[], size: { w: number; h: number }, plan: PlanSize, gap = 20): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    existing.some((p) => x < p.x + p.w + gap / 2 && p.x < x + size.w + gap / 2 && y < p.y + p.h + gap / 2 && p.y < y + size.h + gap / 2);
  for (let y = gap; y + size.h <= plan.height; y += size.h + gap) {
    for (let x = gap; x + size.w <= plan.width; x += size.w + gap) {
      if (!overlaps(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}
