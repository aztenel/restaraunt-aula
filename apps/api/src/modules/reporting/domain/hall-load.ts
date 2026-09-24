import { OpeningHours, Weekday, WEEKDAYS } from '../../../shared/kernel/time';
import { Translatable } from '../../../shared/kernel/translatable';
import { ratio } from './amounts';
import { weekdayOfDate } from './period';

/**
 * Загрузка залов по дням недели: занятое бронями время / время работы филиала × число мест.
 * В разрезе типа места (стол, VIP-зал, юрта — справочник, не зашит в код).
 * Накладки — пересечение интервалов двух действующих броней одного места (цель ТЗ: 0 в месяц).
 */

/** Статусы брони, при которых место было занято (для загрузки и накладок). */
export const OCCUPYING_RESERVATION_STATUSES = ['pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show'] as const;

export interface LoadVenue {
  venueId: string;
  branchId: string;
  typeCode: string;
  typeName: Translatable;
}

export interface LoadBranch {
  branchId: string;
  openingHours: OpeningHours;
}

export interface LoadReservation {
  reservationId: string;
  branchId: string;
  venueId: string;
  venueTypeCode: string;
  /** Локальная дата начала. */
  startDate: string;
  start: Date;
  end: Date;
  guests: number;
}

export interface HallLoadRow {
  weekday: Weekday;
  venueTypeCode: string;
  venueTypeName: Translatable;
  venues: number;
  openMinutes: number;
  bookedMinutes: number;
  load: number | null;
  reservations: number;
  guests: number;
}

export interface HallLoadWeekday {
  weekday: Weekday;
  openMinutes: number;
  bookedMinutes: number;
  load: number | null;
  reservations: number;
  guests: number;
}

export interface HallLoad {
  rows: HallLoadRow[];
  weekdays: HallLoadWeekday[];
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/**
 * Минуты работы, начинающиеся в эту дату (интервал через полночь относится к дню открытия,
 * чтобы ночной «хвост» не считался дважды).
 */
export function openMinutesOnDate(hours: OpeningHours, date: string): number {
  const intervals = hours[weekdayOfDate(date)] ?? [];
  let total = 0;
  for (const interval of intervals) {
    const open = minutesOf(interval.open);
    const close = minutesOf(interval.close);
    total += close > open ? close - open : 24 * 60 - open + close;
  }
  return total;
}

function durationMinutes(r: LoadReservation): number {
  return Math.max(0, Math.round((r.end.getTime() - r.start.getTime()) / 60_000));
}

export function computeHallLoad(input: {
  dates: readonly string[];
  branches: readonly LoadBranch[];
  venues: readonly LoadVenue[];
  reservations: readonly LoadReservation[];
}): HallLoad {
  const hoursByBranch = new Map(input.branches.map((b) => [b.branchId, b.openingHours]));
  const typeNames = new Map<string, Translatable>();
  for (const venue of input.venues) if (!typeNames.has(venue.typeCode)) typeNames.set(venue.typeCode, venue.typeName);

  const key = (weekday: Weekday, typeCode: string) => `${weekday}|${typeCode}`;
  const rows = new Map<string, HallLoadRow>();
  const row = (weekday: Weekday, typeCode: string): HallLoadRow => {
    const k = key(weekday, typeCode);
    let r = rows.get(k);
    if (!r) {
      r = {
        weekday,
        venueTypeCode: typeCode,
        venueTypeName: typeNames.get(typeCode) ?? {},
        venues: 0,
        openMinutes: 0,
        bookedMinutes: 0,
        load: null,
        reservations: 0,
        guests: 0,
      };
      rows.set(k, r);
    }
    return r;
  };

  // Доступное время: для каждой даты периода — часы работы филиала × места каждого типа.
  const venuesByType = new Map<string, LoadVenue[]>();
  for (const venue of input.venues) venuesByType.set(venue.typeCode, [...(venuesByType.get(venue.typeCode) ?? []), venue]);
  const weekdaysWithDates = new Set(input.dates.map(weekdayOfDate));
  for (const [typeCode, venues] of venuesByType) {
    for (const weekday of WEEKDAYS) {
      if (!weekdaysWithDates.has(weekday)) continue;
      row(weekday, typeCode).venues = venues.length;
    }
    for (const date of input.dates) {
      const r = row(weekdayOfDate(date), typeCode);
      for (const venue of venues) {
        const hours = hoursByBranch.get(venue.branchId);
        if (hours) r.openMinutes += openMinutesOnDate(hours, date);
      }
    }
  }

  // Занятое время: длительность действующих броней по дню недели их начала.
  const dates = new Set(input.dates);
  for (const reservation of input.reservations) {
    if (!dates.has(reservation.startDate)) continue;
    const r = row(weekdayOfDate(reservation.startDate), reservation.venueTypeCode);
    r.bookedMinutes += durationMinutes(reservation);
    r.reservations += 1;
    r.guests += reservation.guests;
  }

  const sortedRows = [...rows.values()]
    .map((r) => ({ ...r, load: ratio(r.bookedMinutes, r.openMinutes) }))
    .sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.venueTypeCode.localeCompare(b.venueTypeCode));

  const weekdays: HallLoadWeekday[] = WEEKDAYS.filter((w) => weekdaysWithDates.has(w)).map((weekday) => {
    const items = sortedRows.filter((r) => r.weekday === weekday);
    const openMinutes = items.reduce((a, r) => a + r.openMinutes, 0);
    const bookedMinutes = items.reduce((a, r) => a + r.bookedMinutes, 0);
    return {
      weekday,
      openMinutes,
      bookedMinutes,
      load: ratio(bookedMinutes, openMinutes),
      reservations: items.reduce((a, r) => a + r.reservations, 0),
      guests: items.reduce((a, r) => a + r.guests, 0),
    };
  });
  return { rows: sortedRows, weekdays };
}

export interface OverbookingCandidate {
  reservationId: string;
  venueId: string;
  start: Date;
  end: Date;
}

/** Пары пересекающихся броней одного места (полуоткрытые интервалы [start, end)). */
export function findOverbookings<T extends OverbookingCandidate>(reservations: readonly T[]): Array<[T, T]> {
  const byVenue = new Map<string, T[]>();
  for (const r of reservations) byVenue.set(r.venueId, [...(byVenue.get(r.venueId) ?? []), r]);
  const pairs: Array<[T, T]> = [];
  for (const list of byVenue.values()) {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime() || a.reservationId.localeCompare(b.reservationId));
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[j]!.start >= sorted[i]!.end) break;
        pairs.push([sorted[i]!, sorted[j]!]);
      }
    }
  }
  return pairs;
}
