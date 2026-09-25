import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { BookingChannel, bookingWindow, BookingWindow } from '../domain/availability';
import { BookableVenue } from '../domain/booking';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';
import { VenueDetails, VenueRepository } from '../infrastructure/venue.repository';

export function bookableOf(venue: VenueDetails): BookableVenue {
  return {
    branchId: venue.branchId,
    isActive: venue.isActive,
    hallActive: venue.hall.isActive,
    typeActive: venue.type.isActive,
    bookableOnline: venue.rules.bookableOnline,
  };
}

/** Загрузка филиала, места и окна брони для действий бронирования. */
@Injectable()
export class BookingContext {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly venues: VenueRepository,
    private readonly settings: ReservationSettingsRepository,
    private readonly clock: Clock,
  ) {}

  async branch(branchId: string): Promise<BranchInfo> {
    const branch = await this.branches.find(branchId);
    if (!branch) throw new NotFoundError('branch', branchId);
    return branch;
  }

  async venue(venueId: string): Promise<VenueDetails> {
    const venue = await this.venues.findDetailed(venueId);
    if (!venue) throw new NotFoundError('venue', venueId);
    return venue;
  }

  async window(branch: BranchInfo, channel: BookingChannel): Promise<BookingWindow> {
    const settings = await this.settings.get(branch.id);
    return bookingWindow(channel, {
      now: this.clock.now(),
      timezone: branch.timezone,
      openingHours: branch.openingHours,
      minLeadMinutes: settings.minLeadMinutes,
      maxDaysAhead: settings.maxDaysAhead,
    });
  }
}
