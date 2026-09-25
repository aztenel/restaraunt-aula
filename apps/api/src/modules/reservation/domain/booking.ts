import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { TimeRange } from '../../../shared/kernel/time';
import { BookingChannel, BookingWindow, checkBookingWindow } from './availability';

/** Правила оформления брони, общие для витрины и оператора. */
export interface BookableVenue {
  branchId: string;
  isActive: boolean;
  hallActive: boolean;
  typeActive: boolean;
  bookableOnline: boolean;
}

/** Место принадлежит филиалу, активно (и его зал, и тип); на витрине — только места с онлайн-бронью. */
export function assertVenueBookable(venue: BookableVenue, branchId: string, channel: BookingChannel): void {
  if (venue.branchId !== branchId) {
    throw new ValidationError('reservation.venue_other_branch', 'Venue belongs to another branch');
  }
  if (!venue.isActive || !venue.hallActive || !venue.typeActive) {
    throw new ValidationError('reservation.venue_unavailable', 'Venue is not available for booking');
  }
  if (channel === 'web' && !venue.bookableOnline) {
    throw new ValidationError('reservation.venue_not_bookable_online', 'This venue can be booked only by phone');
  }
}

const SLOT_MESSAGES = {
  past: 'Reservation time is in the past',
  too_soon: 'Reservation time is too soon',
  too_far: 'Reservation time is too far ahead',
  closed: 'The branch is closed at this time',
} as const;

/** Время брони в окне канала и в часах работы: 'reservation.slot_past' | _too_soon | _too_far | _closed. */
export function assertSlotAllowed(range: TimeRange, window: BookingWindow): void {
  const rejection = checkBookingWindow(range, window);
  if (rejection) {
    throw new ValidationError(`reservation.slot_${rejection}`, SLOT_MESSAGES[rejection], {
      start: range.start.toISOString(),
      end: range.end.toISOString(),
    });
  }
}

/** Повтор запроса с тем же ключом идемпотентности должен совпадать с исходным (место, время, телефон). */
export function assertSameBookingRequest(
  existing: { venueId: string; start: Date; phone: string | null },
  request: { venueId: string; start: Date; phone: string | null },
): void {
  if (existing.venueId !== request.venueId || existing.start.getTime() !== request.start.getTime() || existing.phone !== request.phone) {
    throw new ConflictError('reservation.idempotency_key_reused', 'Idempotency key was used for another reservation');
  }
}
