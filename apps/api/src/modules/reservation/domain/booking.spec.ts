import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { OpeningHours, WEEKDAYS, zonedTimeToUtc } from '../../../shared/kernel/time';
import { bookingWindow, slotRange } from './availability';
import { assertSameBookingRequest, assertSlotAllowed, assertVenueBookable, BookableVenue } from './booking';

const venue: BookableVenue = { branchId: 'b1', isActive: true, hallActive: true, typeActive: true, bookableOnline: false };
const HOURS: OpeningHours = Object.fromEntries(WEEKDAYS.map((d) => [d, [{ open: '10:00', close: '23:00' }]]));

describe('booking rules', () => {
  it('venue must belong to the branch and be active; online only for bookable venues', () => {
    expect(() => assertVenueBookable(venue, 'b1', 'admin')).not.toThrow();
    expect(() => assertVenueBookable(venue, 'b1', 'web')).toThrow(expect.objectContaining({ code: 'reservation.venue_not_bookable_online' }));
    expect(() => assertVenueBookable(venue, 'b2', 'admin')).toThrow(expect.objectContaining({ code: 'reservation.venue_other_branch' }));
    expect(() => assertVenueBookable({ ...venue, hallActive: false }, 'b1', 'admin')).toThrow(
      expect.objectContaining({ code: 'reservation.venue_unavailable' }),
    );
  });

  it('slot rejection is mapped to a machine code', () => {
    const window = bookingWindow('web', {
      now: zonedTimeToUtc('2026-10-25', '12:00', 'Asia/Almaty'),
      timezone: 'Asia/Almaty',
      openingHours: HOURS,
      minLeadMinutes: 60,
      maxDaysAhead: 30,
    });
    expect(() => assertSlotAllowed(slotRange('2026-10-25', '22:00', 'Asia/Almaty', 120), window)).toThrow(
      expect.objectContaining({ code: 'reservation.slot_closed' }),
    );
    expect(() => assertSlotAllowed(slotRange('2026-10-25', '12:30', 'Asia/Almaty', 60), window)).toThrow(ValidationError);
    expect(() => assertSlotAllowed(slotRange('2026-10-25', '18:00', 'Asia/Almaty', 120), window)).not.toThrow();
  });

  it('idempotent replay must repeat the same request', () => {
    const start = new Date('2026-10-25T14:00:00Z');
    const a = { venueId: 'v1', start, phone: '+77011234567' };
    expect(() => assertSameBookingRequest(a, { ...a })).not.toThrow();
    expect(() => assertSameBookingRequest(a, { ...a, venueId: 'v2' })).toThrow(ConflictError);
    expect(() => assertSameBookingRequest(a, { ...a, start: new Date(start.getTime() + 1) })).toThrow(ConflictError);
  });
});
