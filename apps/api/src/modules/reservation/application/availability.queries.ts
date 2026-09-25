import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { addDays, startOfLocalDay } from '../../../shared/kernel/time';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import {
  assertLocalDateTime,
  bookingWindow,
  findFreeVenues,
  SlotRejection,
  suggestAlternatives,
  VenueCandidate,
} from '../domain/availability';
import { VenuePosition } from '../domain/venue';
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
      return { ...base, available: false, reason: 'not_accepting', venues: [], alternatives: [] };
    }
    const venues = (await this.venues.listDetailed({ branchIds: [branch.id], activeOnly: true, typeCode: query.typeCode ?? undefined })).filter(
      (v) => v.rules.bookableOnline,
    );
    const { candidates, busy, window } = await this.slotInputs(branch, venues, query.date);
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
          photos: this.views.images(v.photos),
        };
      }),
      alternatives: alternatives.map((a) => ({ date: a.date, time: a.time, start: a.start, venueIds: a.venueIds })),
    };
  }

  async hallMap(slug: string, locale: Locale, slot: SlotQuery | null): Promise<PublicHallMapView> {
    const branch = await this.branchBySlug(slug);
    const halls = await this.halls.list({ branchIds: [branch.id], activeOnly: true });
    const venues = await this.venues.listDetailed({ branchIds: [branch.id], activeOnly: true });
    let free: Set<string> | null = null;
    if (slot) {
      assertLocalDateTime(slot.date, slot.time);
      const online = branch.settings.acceptsReservations ? venues.filter((v) => v.rules.bookableOnline) : [];
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
            photos: this.views.images(v.photos),
            available: free ? free.has(v.id) : null,
          })),
      })),
    };
  }

  /** Кандидаты, занятость (день запроса с запасом на длительность брони) и окно брони витрины. */
  private async slotInputs(branch: BranchInfo, venues: readonly VenueDetails[], date: string) {
    const candidates: VenueCandidate[] = venues.map((v) => ({
      venueId: v.id,
      capacityMin: v.capacityMin,
      capacityMax: v.capacityMax,
      rules: v.rules,
    }));
    const from = startOfLocalDay(date, branch.timezone);
    const to = startOfLocalDay(addDays(date, 3), branch.timezone);
    const busy = await this.reservations.busyIntervals(
      candidates.map((c) => c.venueId),
      from,
      to,
    );
    const settings = await this.settings.get(branch.id);
    const window = bookingWindow('web', {
      now: this.clock.now(),
      timezone: branch.timezone,
      openingHours: branch.openingHours,
      minLeadMinutes: settings.minLeadMinutes,
      maxDaysAhead: settings.maxDaysAhead,
    });
    return { candidates, busy, window };
  }
}
