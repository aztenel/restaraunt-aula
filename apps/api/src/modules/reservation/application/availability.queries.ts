import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { addDays, addMinutes, startOfLocalDay } from '../../../shared/kernel/time';
import { Locale, Translatable, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import {
  assertLocalDateTime,
  bookingCalendarDates,
  BookingChannel,
  BookingDay,
  bookingDays,
  BookingWindow,
  bookingWindow,
  DEFAULT_SLOT_STEP_MINUTES,
  findFreeVenues,
  SlotRejection,
  suggestAlternatives,
  VenueCandidate,
} from '../domain/availability';
import { VenuePosition } from '../domain/venue';
import { VenueRules } from '../domain/venue-rules';
import { HallRepository } from '../infrastructure/hall.repository';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';
import { VenueDetails, VenueRepository } from '../infrastructure/venue.repository';
import { ImageView, ReservationViewMapper } from './reservation-views';

export type AvailabilityReason = SlotRejection | 'no_capacity' | 'occupied' | 'not_accepting';

export interface PublicVenueSlotView {
  venueId: string;
  hallId: string;
  hallName: string;
  name: string;
  description: string;
  typeCode: string;
  typeName: string;
  capacityMin: number;
  capacityMax: number;
  deposit: MoneyJson | null;
  start: Date;
  end: Date;
  durationMinutes: number;
  rules: { holdMinutes: number; cancellationDeadlineHours: number; requiresManualConfirmation: boolean };
  position: VenuePosition;
  photos: ImageView[];
}

export interface AlternativeTimeView {
  date: string;
  time: string;
  start: Date;
  venueIds: string[];
}

/** Окно брони витрины: сетка времени, длительность, упреждение, горизонт и допустимые времена начала по датам. */
export interface BookingWindowView {
  timezone: string;
  slotStepMinutes: number;
  durationMinutes: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
  earliestStart: Date;
  latestStart: Date;
  days: BookingDay[];
}

export interface AvailabilityView {
  branchId: string;
  branchSlug: string;
  date: string;
  time: string;
  guests: number;
  durationMinutes: number | null;
  available: boolean;
  reason: AvailabilityReason | null;
  venues: PublicVenueSlotView[];
  alternatives: AlternativeTimeView[];
  /** Окно брони на запрошенную дату (null — филиал не принимает брони). */
  bookingWindow: BookingWindowView | null;
}

export interface PublicMapVenueView {
  id: string;
  name: string;
  description: string;
  typeCode: string;
  typeName: string;
  capacityMin: number;
  capacityMax: number;
  deposit: MoneyJson | null;
  position: VenuePosition;
  bookableOnline: boolean;
  photos: ImageView[];
  /** Свободно для онлайн-брони на запрошенное время; null — время не запрошено. */
  available: boolean | null;
}

export interface PublicHallView {
  id: string;
  name: string;
  description: string;
  planWidth: number;
  planHeight: number;
  background: ImageView | null;
  venues: PublicMapVenueView[];
}

export interface PublicHallMapView {
  branchId: string;
  branchSlug: string;
  acceptsReservations: boolean;
  halls: PublicHallView[];
  /** Окно брони по датам от сегодня до горизонта (null — филиал не принимает брони). */
  bookingWindow: BookingWindowView | null;
}

export interface AdminVenueSlotView {
  venueId: string;
  hallId: string;
  hallName: Translatable;
  code: string;
  name: Translatable;
  typeCode: string;
  typeName: Translatable;
  capacityMin: number;
  capacityMax: number;
  /** Гостей меньше минимальной вместимости (оператор может посадить, витрина — нет). */
  belowMinimum: boolean;
  deposit: MoneyJson | null;
  start: Date;
  end: Date;
  /** Конец занятости места: конец брони + буфер уборки. */
  blockedUntil: Date;
  durationMinutes: number;
  rules: VenueRules;
  bookableOnline: boolean;
  position: VenuePosition;
}

export interface AdminAvailabilityView {
  branchId: string;
  date: string;
  time: string;
  guests: number;
  durationMinutes: number | null;
  available: boolean;
  reason: AvailabilityReason | null;
  venues: AdminVenueSlotView[];
  alternatives: AlternativeTimeView[];
}

export interface AdminSlotQuery extends SlotQuery {
  hallId?: string | null;
  /** Не учитывать занятость этой брони (перенос / пересадка). */
  excludeReservationId?: string | null;
}

export interface SlotQuery {
  date: string;
  time: string;
  guests: number;
  durationMinutes?: number | null;
  typeCode?: string | null;
}

/**
 * Витрина: свободные места на время (только реально свободные: вместимость, часы работы филиала
 * в его часовом поясе, пересечение [начало, конец + уборка) с занимающими бронями и банкетами),
 * альтернативное время, если мест нет; карта залов для визуального выбора места.
 */
@Injectable()
export class AvailabilityQueries {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly halls: HallRepository,
    private readonly venues: VenueRepository,
    private readonly reservations: ReservationRepository,
    private readonly settings: ReservationSettingsRepository,
    private readonly views: ReservationViewMapper,
    private readonly clock: Clock,
  ) {}

  async branchBySlug(slug: string): Promise<BranchInfo> {
    const branch = await this.branches.findBySlug(slug);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', slug);
    return branch;
  }

  async availability(slug: string, query: SlotQuery, locale: Locale): Promise<AvailabilityView> {
    const branch = await this.branchBySlug(slug);
    assertLocalDateTime(query.date, query.time);
    const base = {
      branchId: branch.id,
      branchSlug: branch.slug,
      date: query.date,
      time: query.time,
      guests: query.guests,
      durationMinutes: query.durationMinutes ?? null,
    };
    if (!branch.settings.acceptsReservations) {
      return { ...base, available: false, reason: 'not_accepting', venues: [], alternatives: [], bookingWindow: null };
    }
    const venues = (await this.venues.listDetailed({ branchIds: [branch.id], activeOnly: true, typeCode: query.typeCode ?? undefined })).filter(
      (v) => v.rules.bookableOnline,
    );
    const { candidates, busy, window, settings } = await this.slotInputs(branch, venues, query.date);
    const result = findFreeVenues({
      candidates,
      busy,
      guests: query.guests,
      date: query.date,
      time: query.time,
      durationMinutes: query.durationMinutes,
      window,
    });
    const byId = new Map(venues.map((v) => [v.id, v]));
    const alternatives =
      result.free.length === 0 && result.reason !== 'no_capacity'
        ? suggestAlternatives({
            candidates,
            busy,
            guests: query.guests,
            date: query.date,
            time: query.time,
            durationMinutes: query.durationMinutes,
            window,
          })
        : [];
    return {
      ...base,
      available: result.free.length > 0,
      reason: result.reason,
      venues: result.free.map((slot) => {
        const v = byId.get(slot.venueId)!;
        return {
          venueId: v.id,
          hallId: v.hallId,
          hallName: translate(v.hall.name, locale),
          name: translate(v.name, locale),
          description: translate(v.description, locale),
          typeCode: v.type.code,
          typeName: translate(v.type.name, locale),
          capacityMin: v.capacityMin,
          capacityMax: v.capacityMax,
          deposit: v.deposit?.toJSON() ?? null,
          start: slot.range.start,
          end: slot.range.end,
          durationMinutes: slot.durationMinutes,
          rules: {
            holdMinutes: v.rules.holdMinutes,
            cancellationDeadlineHours: v.rules.cancellationDeadlineHours,
            requiresManualConfirmation: v.rules.requiresManualConfirmation,
          },
          position: { ...v.position },
          photos: this.views.imageList(v.photos),
        };
      }),
      alternatives: alternatives.map((a) => ({ date: a.date, time: a.time, start: a.start, venueIds: a.venueIds })),
      bookingWindow: bookingWindowView(window, settings, candidates, [query.date], query.durationMinutes),
    };
  }

  /**
   * Свободные места для оператора (бронь по телефону, перенос): включая места только для брони
   * через оператора (bookableOnline = false), без ограничений витрины по упреждению и горизонту
   * (часы работы соблюдаются, начало — не раньше чем 15 минут назад), без проверки минимальной вместимости.
   */
  async adminAvailability(branchId: string, query: AdminSlotQuery): Promise<AdminAvailabilityView> {
    const branch = await this.branches.find(branchId);
    if (!branch) throw new NotFoundError('branch', branchId);
    assertLocalDateTime(query.date, query.time);
    const venues = await this.venues.listDetailed({
      branchIds: [branch.id],
      activeOnly: true,
      typeCode: query.typeCode ?? undefined,
      hallId: query.hallId ?? undefined,
    });
    const inputs = await this.slotInputs(branch, venues, query.date, 'admin');
    // Оператор может посадить меньше минимальной вместимости — проверяется только максимум.
    const candidates = inputs.candidates.map((c) => ({ ...c, capacityMin: 1 }));
    const busy = query.excludeReservationId ? inputs.busy.filter((b) => b.reservationId !== query.excludeReservationId) : inputs.busy;
    const slot = { candidates, busy, guests: query.guests, date: query.date, time: query.time, durationMinutes: query.durationMinutes, window: inputs.window };
    const result = findFreeVenues(slot);
    const alternatives = result.free.length === 0 && result.reason !== 'no_capacity' ? suggestAlternatives(slot) : [];
    const byId = new Map(venues.map((v) => [v.id, v]));
    return {
      branchId: branch.id,
      date: query.date,
      time: query.time,
      guests: query.guests,
      durationMinutes: query.durationMinutes ?? null,
      available: result.free.length > 0,
      reason: result.reason,
      venues: result.free.map((free) => {
        const v = byId.get(free.venueId)!;
        return {
          venueId: v.id,
          hallId: v.hallId,
          hallName: v.hall.name,
          code: v.code,
          name: v.name,
          typeCode: v.type.code,
          typeName: v.type.name,
          capacityMin: v.capacityMin,
          capacityMax: v.capacityMax,
          belowMinimum: query.guests < v.capacityMin,
          deposit: v.deposit?.toJSON() ?? null,
          start: free.range.start,
          end: free.range.end,
          blockedUntil: free.blocked.end,
          durationMinutes: free.durationMinutes,
          rules: { ...v.rules },
          bookableOnline: v.rules.bookableOnline,
          position: { ...v.position },
        };
      }),
      alternatives: alternatives.map((a) => ({ date: a.date, time: a.time, start: a.start, venueIds: a.venueIds })),
    };
  }

  async hallMap(slug: string, locale: Locale, slot: SlotQuery | null): Promise<PublicHallMapView> {
    const branch = await this.branchBySlug(slug);
    const halls = await this.halls.list({ branchIds: [branch.id], activeOnly: true });
    const venues = await this.venues.listDetailed({ branchIds: [branch.id], activeOnly: true });
    const online = branch.settings.acceptsReservations ? venues.filter((v) => v.rules.bookableOnline) : [];
    let free: Set<string> | null = null;
    let calendar: BookingWindowView | null = null;
    if (branch.settings.acceptsReservations) {
      const settings = await this.settings.get(branch.id);
      const window = this.webWindow(branch, settings);
      calendar = bookingWindowView(window, settings, online.map(candidateOf), bookingCalendarDates(window), slot?.durationMinutes);
    }
    if (slot) {
      assertLocalDateTime(slot.date, slot.time);
      const { candidates, busy, window } = await this.slotInputs(branch, online, slot.date);
      const result = findFreeVenues({
        candidates,
        busy,
        guests: slot.guests,
        date: slot.date,
        time: slot.time,
        durationMinutes: slot.durationMinutes,
        window,
      });
      free = new Set(result.free.map((f) => f.venueId));
    }
    return {
      branchId: branch.id,
      branchSlug: branch.slug,
      acceptsReservations: branch.settings.acceptsReservations,
      halls: halls.map((h) => ({
        id: h.id,
        name: translate(h.name, locale),
        description: translate(h.description, locale),
        planWidth: h.plan.width,
        planHeight: h.plan.height,
        background: this.views.image(h.background),
        venues: venues
          .filter((v) => v.hallId === h.id)
          .map((v) => ({
            id: v.id,
            name: translate(v.name, locale),
            description: translate(v.description, locale),
            typeCode: v.type.code,
            typeName: translate(v.type.name, locale),
            capacityMin: v.capacityMin,
            capacityMax: v.capacityMax,
            deposit: v.deposit?.toJSON() ?? null,
            position: { ...v.position },
            bookableOnline: v.rules.bookableOnline,
            photos: this.views.imageList(v.photos),
            available: free ? free.has(v.id) : null,
          })),
      })),
      bookingWindow: calendar,
    };
  }

  private webWindow(branch: BranchInfo, settings: { minLeadMinutes: number; maxDaysAhead: number }): BookingWindow {
    return bookingWindow('web', {
      now: this.clock.now(),
      timezone: branch.timezone,
      openingHours: branch.openingHours,
      minLeadMinutes: settings.minLeadMinutes,
      maxDaysAhead: settings.maxDaysAhead,
    });
  }

  /** Кандидаты, занятость (день запроса с запасом на длительность брони) и окно брони канала (по умолчанию — витрины). */
  private async slotInputs(branch: BranchInfo, venues: readonly VenueDetails[], date: string, channel: BookingChannel = 'web') {
    const candidates: VenueCandidate[] = venues.map(candidateOf);
    const from = startOfLocalDay(date, branch.timezone);
    const to = startOfLocalDay(addDays(date, 3), branch.timezone);
    const busy = await this.reservations.busyIntervals(
      candidates.map((c) => c.venueId),
      from,
      to,
    );
    const settings = await this.settings.get(branch.id);
    const window = bookingWindow(channel, {
      now: this.clock.now(),
      timezone: branch.timezone,
      openingHours: branch.openingHours,
      minLeadMinutes: settings.minLeadMinutes,
      maxDaysAhead: settings.maxDaysAhead,
    });
    return { candidates, busy, window, settings };
  }
}

function candidateOf(v: VenueDetails): VenueCandidate {
  return { venueId: v.id, capacityMin: v.capacityMin, capacityMax: v.capacityMax, rules: v.rules };
}

/** Длительность брони места по умолчанию, если мест для онлайн-брони нет (для расчёта окна). */
const FALLBACK_DURATION_MINUTES = 120;

/**
 * Окно брони витрины: шаг сетки — минимальный среди мест онлайн-брони (как у подбора альтернатив),
 * длительность — из запроса или минимальная по умолчанию среди этих мест.
 */
function bookingWindowView(
  window: BookingWindow,
  settings: { minLeadMinutes: number; maxDaysAhead: number },
  candidates: readonly VenueCandidate[],
  dates: readonly string[],
  durationMinutes?: number | null,
): BookingWindowView {
  const slotStepMinutes = candidates.length > 0 ? Math.min(...candidates.map((c) => c.rules.slotStepMinutes || DEFAULT_SLOT_STEP_MINUTES)) : DEFAULT_SLOT_STEP_MINUTES;
  const duration = durationMinutes ?? (candidates.length > 0 ? Math.min(...candidates.map((c) => c.rules.durationMinutes)) : FALLBACK_DURATION_MINUTES);
  return {
    timezone: window.timezone,
    slotStepMinutes,
    durationMinutes: duration,
    minLeadMinutes: settings.minLeadMinutes,
    maxDaysAhead: settings.maxDaysAhead,
    earliestStart: addMinutes(window.now, settings.minLeadMinutes),
    latestStart: addMinutes(window.now, settings.maxDaysAhead * 1440),
    days: bookingDays({ window, stepMinutes: slotStepMinutes, durationMinutes: duration, dates }),
  };
}
