import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel/errors';
import { addMinutes, TimeRange } from '../../../shared/kernel/time';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { VenueDetails, VenueRepository } from '../infrastructure/venue.repository';
import { VenueAvailability, VenueOccupancy, VenueSummary } from '../public';
import { HoldVenueForBanquet, MoveBanquetHold, ReleaseBanquetHold } from './banquet-holds.actions';

export function venueSummary(v: VenueDetails): VenueSummary {
  return {
    id: v.id,
    branchId: v.branchId,
    hallId: v.hallId,
    hallName: v.hall.name,
    name: v.name,
    typeId: v.typeId,
    typeCode: v.type.code,
    typeName: v.type.name,
    capacityMin: v.capacityMin,
    capacityMax: v.capacityMax,
    deposit: v.deposit?.toJSON() ?? null,
    isActive: v.isActive && v.hall.isActive && v.type.isActive,
  };
}

/**
 * Реализация контракта VenueAvailability для модуля Banquet: календарь занятости залов синхронен
 * с бронью — банкет занимает зал тем же механизмом (бронь вида banquet). Каждый метод — делегирование
 * действию или запросу.
 */
@Injectable()
export class VenueAvailabilityService extends VenueAvailability {
  constructor(
    private readonly venues: VenueRepository,
    private readonly reservations: ReservationRepository,
    private readonly hold: HoldVenueForBanquet,
    private readonly moveHold: MoveBanquetHold,
    private readonly release: ReleaseBanquetHold,
  ) {
    super();
  }

  async listVenues(branchId: string): Promise<VenueSummary[]> {
    return (await this.venues.listDetailed({ branchIds: [branchId] })).map(venueSummary);
  }

  async getVenue(venueId: string): Promise<VenueSummary> {
    const venue = await this.venues.findDetailed(venueId);
    if (!venue) throw new NotFoundError('venue', venueId);
    return venueSummary(venue);
  }

  /** Свободно ли место в [start, end + буфер уборки места) с учётом всех занимающих броней (кроме exclude). */
  async isAvailable(venueId: string, start: Date, end: Date, excludeReservationId?: string | null): Promise<boolean> {
    const venue = await this.venues.findDetailed(venueId);
    if (!venue) throw new NotFoundError('venue', venueId);
    const range = new TimeRange(start, end);
    const conflicting = await this.reservations.findBlockingOverlap(
      venueId,
      range.start,
      addMinutes(range.end, venue.rules.cleanupMinutes),
      excludeReservationId,
    );
    return conflicting === null;
  }

  holdForBanquet(input: { venueId: string; start: Date; end: Date; guests: number; banquetRequestId: string; note?: string | null }) {
    return this.hold.execute(input);
  }

  moveBanquetHold(reservationId: string, input: { venueId: string; start: Date; end: Date; guests: number }): Promise<void> {
    return this.moveHold.execute(reservationId, input);
  }

  releaseBanquetHold(reservationId: string, reason: string): Promise<void> {
    return this.release.execute(reservationId, reason);
  }

  async occupancy(branchId: string, from: Date, to: Date): Promise<VenueOccupancy[]> {
    const range = new TimeRange(from, to);
    return (await this.reservations.occupancy(branchId, range.start, range.end)).map((r) => ({
      reservationId: r.id,
      venueId: r.venueId,
      kind: r.kind,
      status: r.status,
      start: r.start.toISOString(),
      end: r.end.toISOString(),
      guests: r.guests,
      banquetRequestId: r.banquetRequestId,
    }));
  }
}
