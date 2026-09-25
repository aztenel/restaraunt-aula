import { Reservation, SlotChange, StatusChange } from '../domain/reservation';
import {
  ReservationCreatedPayload,
  ReservationEventCustomer,
  ReservationRescheduledPayload,
  ReservationSlotSnapshot,
  ReservationStatusChangedPayload,
} from '../public';
import { VenueDetails } from '../infrastructure/venue.repository';

/**
 * Payload событий модуля (контракт public/index.ts): только JSON-совместимые данные — деньги как MoneyJson,
 * даты как ISO-строки. Подписчики (Reporting, Customers) не ходят в таблицы брони.
 */
function customerOf(r: Reservation): ReservationEventCustomer {
  return { customerId: r.customer.id, phone: r.customer.phone, name: r.customer.name };
}

export function createdPayload(r: Reservation, venue: VenueDetails, at: Date): ReservationCreatedPayload {
  const p = r.snapshot();
  return {
    reservationId: p.id,
    number: p.number,
    branchId: p.branchId,
    venueId: p.venueId,
    venueName: venue.name,
    venueTypeCode: venue.type.code,
    kind: p.kind,
    status: p.status,
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    guests: p.guests,
    customer: customerOf(r),
    deposit: r.chargedDeposit()?.toJSON() ?? null,
    banquetRequestId: p.banquetRequestId,
    source: p.source,
    locale: p.locale,
    publicToken: p.publicToken,
    occurredAt: at.toISOString(),
  };
}

export function statusChangedPayload(r: Reservation, change: StatusChange, venue: VenueDetails): ReservationStatusChangedPayload {
  const p = r.snapshot();
  return {
    reservationId: p.id,
    number: p.number,
    branchId: p.branchId,
    venueId: p.venueId,
    venueTypeCode: venue.type.code,
    kind: p.kind,
    from: change.from,
    to: change.to,
    start: p.start.toISOString(),
    end: p.end.toISOString(),
    guests: p.guests,
    customer: customerOf(r),
    deposit: r.chargedDeposit()?.toJSON() ?? null,
    depositOutcome: change.depositOutcome,
    reason: change.reason,
    locale: p.locale,
    publicToken: p.publicToken,
    occurredAt: change.at.toISOString(),
  };
}

function slotOf(slot: SlotChange['before'], venue: VenueDetails): ReservationSlotSnapshot {
  return {
    venueId: slot.venueId,
    venueName: venue.name,
    venueTypeCode: venue.type.code,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    guests: slot.guests,
  };
}

export function rescheduledPayload(
  r: Reservation,
  change: SlotChange,
  venues: { before: VenueDetails; after: VenueDetails },
  reason: string | null,
  at: Date,
): ReservationRescheduledPayload {
  const p = r.snapshot();
  return {
    reservationId: p.id,
    number: p.number,
    branchId: p.branchId,
    kind: p.kind,
    status: p.status,
    from: slotOf(change.before, venues.before),
    to: slotOf(change.after, venues.after),
    customer: customerOf(r),
    banquetRequestId: p.banquetRequestId,
    reason,
    locale: p.locale,
    publicToken: p.publicToken,
    occurredAt: at.toISOString(),
  };
}
