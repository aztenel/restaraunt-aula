/**
 * Подбор мест для брони оператором и состояние мест на карте зала — по данным сервера:
 * занятость из календаря дня (GET /admin/reservations/timeline: start, blockedUntil занимающих броней)
 * и действующие правила мест (GET /admin/venues: длительность и буфер уборки).
 *
 * Это предварительный фильтр для интерфейса («показать только свободные места»). Окончательную проверку
 * делает сервер в транзакции с блокировкой места (409 reservation.venue_occupied), поэтому ошибка
 * сервера всегда показывается и список обновляется. В API нет админского эндпоинта свободных мест:
 * публичный /reservation-availability скрывает места «только по телефону» и применяет ограничения витрины.
 */
import { toMs } from './timeline-layout';
import type { ReservationKind, ReservationStatus, TimelineItem } from './types';

const MINUTE = 60_000;

/** Оператор может оформить бронь с началом чуть в прошлом («живая» посадка) — как на сервере. */
export const STAFF_BACKDATE_GRACE_MINUTES = 15;

export interface BookableVenue {
  id: string;
  hallId: string;
  capacityMin: number;
  capacityMax: number;
  isBookable: boolean;
  rules: { durationMinutes: number; cleanupMinutes: number };
}

export interface OccupancyItem {
  reservationId: string;
  blocking: boolean;
  start: string;
  blockedUntil: string;
}

export type VenueSlotStatus =
  /** Свободно. */
  | 'free'
  /** Гостей больше вместимости (сервер отклонит: capacity_exceeded). */
  | 'too_many_guests'
  /** Место пересекается с другой бронью или банкетом (с учётом буфера уборки). */
  | 'occupied'
  /** Место, его зал или тип выключены. */
  | 'inactive'
  /** Время вне часов работы филиала. */
  | 'closed'
  /** Время в прошлом. */
  | 'past';

export interface VenueSlot {
  venueId: string;
  status: VenueSlotStatus;
  durationMinutes: number;
  start: number;
  end: number;
  /** Занятость места этой бронью: [start, end + уборка). */
  blockedUntil: number;
  /** Гостей меньше минимальной вместимости (оператору можно, но стоит предупредить). */
  belowMinimum: boolean;
  /** Бронь, с которой пересекается слот. */
  conflictId: string | null;
}

export interface SlotRequest {
  /** Начало брони, UTC мс. */
  start: number;
  guests: number;
  /** null — длительность по правилу места. */
  durationMinutes: number | null;
  now: number;
  openingRanges: ReadonlyArray<{ start: string; end: string }>;
  /** Бронь, которую переносим (её собственная занятость не мешает). */
  excludeReservationId?: string | null;
}

function fitsOpening(start: number, end: number, ranges: SlotRequest['openingRanges']): boolean {
  return ranges.some((r) => toMs(r.start) <= start && end <= toMs(r.end));
}

/** Состояние одного места для запрошенного времени. */
export function venueSlot(venue: BookableVenue, occupancy: readonly OccupancyItem[], request: SlotRequest): VenueSlot {
  const durationMinutes = request.durationMinutes ?? venue.rules.durationMinutes;
  const start = request.start;
  const end = start + durationMinutes * MINUTE;
  const blockedUntil = end + venue.rules.cleanupMinutes * MINUTE;
  const base = {
    venueId: venue.id,
    durationMinutes,
    start,
    end,
    blockedUntil,
    belowMinimum: request.guests < venue.capacityMin,
    conflictId: null as string | null,
  };
  if (!venue.isBookable) return { ...base, status: 'inactive' };
  if (request.guests > venue.capacityMax) return { ...base, status: 'too_many_guests' };
  if (start < request.now - STAFF_BACKDATE_GRACE_MINUTES * MINUTE) return { ...base, status: 'past' };
  if (!fitsOpening(start, end, request.openingRanges)) return { ...base, status: 'closed' };
  const conflict = occupancy.find(
    (item) =>
      item.blocking &&
      item.reservationId !== request.excludeReservationId &&
      toMs(item.start) < blockedUntil &&
      start < toMs(item.blockedUntil),
  );
  if (conflict) return { ...base, status: 'occupied', conflictId: conflict.reservationId };
  return { ...base, status: 'free' };
}

export interface VenueChoice<V extends BookableVenue> {
  venue: V;
  slot: VenueSlot;
}

/**
 * Места для выбора: сначала свободные — по возрастанию вместимости (самое подходящее по размеру),
 * затем занятые и неподходящие (для пояснения, почему их нет). onlyFree — только свободные.
 */
export function venueChoices<V extends BookableVenue>(
  venues: readonly V[],
  occupancyByVenue: ReadonlyMap<string, readonly OccupancyItem[]>,
  request: SlotRequest,
  options: { onlyFree?: boolean } = {},
): Array<VenueChoice<V>> {
  const rank: Record<VenueSlotStatus, number> = { free: 0, occupied: 1, too_many_guests: 2, closed: 3, past: 4, inactive: 5 };
  const choices = venues.map((venue) => ({ venue, slot: venueSlot(venue, occupancyByVenue.get(venue.id) ?? [], request) }));
  return choices
    .filter((c) => !options.onlyFree || c.slot.status === 'free')
    .sort(
      (a, b) =>
        rank[a.slot.status] - rank[b.slot.status] ||
        Number(a.slot.belowMinimum) - Number(b.slot.belowMinimum) ||
        a.venue.capacityMax - b.venue.capacityMax,
    );
}

/** Почему свободных мест нет (для подсказки): первая «общая» причина или occupied / no_capacity. */
export function noFreeReason(choices: ReadonlyArray<{ slot: VenueSlot }>): VenueSlotStatus | 'no_venues' | null {
  if (choices.length === 0) return 'no_venues';
  if (choices.some((c) => c.slot.status === 'free')) return null;
  const statuses = new Set(choices.map((c) => c.slot.status));
  for (const status of ['past', 'closed', 'occupied', 'too_many_guests', 'inactive'] as const) {
    if (statuses.has(status)) return status;
  }
  return null;
}

/** Занятость мест из ответа календаря: venueId → брони. */
export function occupancyByVenue(halls: ReadonlyArray<{ venues: ReadonlyArray<{ id: string; items: readonly TimelineItem[] }> }>): Map<string, TimelineItem[]> {
  const map = new Map<string, TimelineItem[]>();
  for (const hall of halls) for (const venue of hall.venues) map.set(venue.id, [...venue.items]);
  return map;
}

// ---------------------------------------------------------------- карта зала: состояние места на момент

export type VenueMapState =
  /** Свободно и ближайшая бронь не скоро. */
  | 'free'
  /** Свободно, но скоро начнётся бронь (в пределах soonMinutes). */
  | 'soon'
  /** Забронировано: ждёт подтверждения / депозита / подтверждено, гости ещё не пришли. */
  | 'reserved'
  /** Гости за столом (arrived). */
  | 'seated'
  /** Зал занят под банкет. */
  | 'banquet'
  /** Идёт уборка после брони (буфер). */
  | 'cleanup'
  /** Место не работает. */
  | 'inactive';

export interface VenueStateAt {
  state: VenueMapState;
  /** Бронь, определяющая состояние (текущая или ближайшая). */
  item: { reservationId: string; status: ReservationStatus; kind: ReservationKind; start: string; end: string } | null;
}

/** Состояние места в момент at (UTC мс) по занимающим броням календаря. */
export function venueStateAt(
  venue: { isActive: boolean; items: readonly TimelineItem[] },
  at: number,
  soonMinutes = 60,
): VenueStateAt {
  if (!venue.isActive) return { state: 'inactive', item: null };
  const blocking = venue.items.filter((i) => i.blocking).sort((a, b) => toMs(a.start) - toMs(b.start));
  const current = blocking.find((i) => toMs(i.start) <= at && at < toMs(i.end));
  if (current) {
    const state: VenueMapState = current.kind === 'banquet' ? 'banquet' : current.status === 'arrived' ? 'seated' : 'reserved';
    return { state, item: current };
  }
  const cleaning = blocking.find((i) => toMs(i.end) <= at && at < toMs(i.blockedUntil));
  if (cleaning) return { state: 'cleanup', item: cleaning };
  const next = blocking.find((i) => toMs(i.start) > at);
  if (next && toMs(next.start) - at <= soonMinutes * MINUTE) return { state: 'soon', item: next };
  return { state: 'free', item: next ?? null };
}
