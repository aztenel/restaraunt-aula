/**
 * Подбор места для брони оператором и переноса — по серверу: GET /admin/reservations/availability
 * отдаёт свободные на это время места (включая «только по телефону»; часы работы, вместимость, занятость
 * с уборкой проверены; упреждение и горизонт витрины к оператору не применяются), причину, если мест нет,
 * и ближайшее свободное время. Здесь — только параметры запроса и раскладка ответа для интерфейса.
 * Окончательную проверку при сохранении делает сервер в транзакции (409 reservation.venue_occupied).
 *
 * Состояние места на карте зала в выбранный момент — по календарю дня (занимающие брони).
 */
import { toMs } from './timeline-layout';
import type { AdminAvailability, AdminAvailabilityQuery, AdminVenueSlot, ReservationKind, ReservationStatus, TimelineItem } from './types';

const MINUTE = 60_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface SlotParams {
  date?: string | null;
  time?: string | null;
  guests?: number | null;
  durationMinutes?: number | null;
  excludeReservationId?: string | null;
}

/** Параметры запроса свободных мест; null — ввод неполный (запрос не отправляется). */
export function availabilityQuery(branchId: string, params: SlotParams): AdminAvailabilityQuery | null {
  if (!params.date || !DATE_RE.test(params.date) || !params.time || !TIME_RE.test(params.time)) return null;
  if (!params.guests || !Number.isInteger(params.guests) || params.guests < 1) return null;
  return {
    branchId,
    date: params.date,
    time: params.time,
    guests: params.guests,
    ...(params.durationMinutes ? { durationMinutes: params.durationMinutes } : {}),
    ...(params.excludeReservationId ? { excludeReservationId: params.excludeReservationId } : {}),
  };
}

export interface HallSlots {
  hallId: string;
  hallName: AdminVenueSlot['hallName'];
  slots: AdminVenueSlot[];
}

/**
 * Свободные места по залам (порядок залов — как у сервера). Внутри зала: сначала места, где гостей не
 * меньше минимума, затем — по возрастанию вместимости (самое подходящее по размеру — первым).
 */
export function slotsByHall(venues: readonly AdminVenueSlot[]): HallSlots[] {
  const halls: HallSlots[] = [];
  for (const slot of venues) {
    let hall = halls.find((h) => h.hallId === slot.hallId);
    if (!hall) {
      hall = { hallId: slot.hallId, hallName: slot.hallName, slots: [] };
      halls.push(hall);
    }
    hall.slots.push(slot);
  }
  for (const hall of halls) {
    hall.slots.sort((a, b) => Number(a.belowMinimum) - Number(b.belowMinimum) || a.capacityMax - b.capacityMax || a.code.localeCompare(b.code));
  }
  return halls;
}

/** Выбранное место свободно в ответе (иначе выбор снимается). */
export function isVenueFree(availability: Pick<AdminAvailability, 'venues'> | null | undefined, venueId: string | null | undefined): boolean {
  return Boolean(venueId && availability?.venues.some((v) => v.venueId === venueId));
}

/**
 * Ближайшее свободное время (кнопки «выбрать 20:30»): без повторов, по времени; число мест —
 * для подписи. currentVenueId — при переносе отмечается, свободно ли текущее место.
 */
export function alternativeOptions(
  availability: Pick<AdminAvailability, 'alternatives'> | null | undefined,
  currentVenueId?: string | null,
): Array<{ time: string; date: string; venues: number; includesCurrent: boolean }> {
  const seen = new Set<string>();
  return (availability?.alternatives ?? [])
    .filter((a) => {
      const key = `${a.date} ${a.time}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((a) => ({ time: a.time, date: a.date, venues: a.venueIds.length, includesCurrent: Boolean(currentVenueId && a.venueIds.includes(currentVenueId)) }));
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
