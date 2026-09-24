import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { Money } from '../../../shared/kernel/money';
import {
  ReservationCreatedPayload,
  ReservationEvents,
  ReservationRescheduledPayload,
  ReservationStatusChangedPayload,
} from '../../reservation/public';
import { localDateOf } from '../domain/period';
import { RESERVATION_STATUS_RANK } from '../domain/revenue';
import { ReservationFact, ReservationFactsRepository } from '../infrastructure/reservation-facts.repository';

type ReservationPayload = Pick<
  ReservationCreatedPayload,
  'reservationId' | 'number' | 'branchId' | 'venueId' | 'venueTypeCode' | 'kind' | 'start' | 'end' | 'guests' | 'deposit'
>;

function fact(p: ReservationPayload, status: string, at: Date, banquetRequestId: string | null): ReservationFact {
  const start = new Date(p.start);
  return {
    reservationId: p.reservationId,
    number: p.number,
    branchId: p.branchId,
    venueId: p.venueId,
    venueTypeCode: p.venueTypeCode,
    kind: p.kind,
    status,
    statusAt: at,
    statusRank: RESERVATION_STATUS_RANK[status] ?? 0,
    start,
    end: new Date(p.end),
    startDate: localDateOf(start),
    guests: p.guests,
    banquetRequestId,
    deposit: p.deposit ? Money.fromJson(p.deposit) : null,
  };
}

/** Проекция броней из событий Reservation: загрузка залов, накладки, число броней и гостей. */
@Injectable()
export class ReportingReservationProjection {
  constructor(private readonly reservations: ReservationFactsRepository) {}

  @OnEvent(ReservationEvents.ReservationCreated)
  async onCreated(e: EventEnvelope<ReservationCreatedPayload>): Promise<void> {
    const p = e.payload;
    const at = new Date(p.occurredAt);
    await this.reservations.applyCreated(fact(p, p.status, at, p.banquetRequestId), {
      venueName: p.venueName,
      source: p.source,
      bookedAt: at,
      bookedDate: localDateOf(at),
    });
  }

  /** Перенос брони или банкетной занятости: место, интервал и гости — из нового слота. */
  @OnEvent(ReservationEvents.ReservationRescheduled)
  async onRescheduled(e: EventEnvelope<ReservationRescheduledPayload>): Promise<void> {
    const p = e.payload;
    const slot = p.to;
    await this.reservations.applyRescheduled(
      fact(
        {
          reservationId: p.reservationId,
          number: p.number,
          branchId: p.branchId,
          venueId: slot.venueId,
          venueTypeCode: slot.venueTypeCode,
          kind: p.kind,
          start: slot.start,
          end: slot.end,
          guests: slot.guests,
          deposit: null,
        },
        p.status,
        new Date(p.occurredAt),
        p.banquetRequestId,
      ),
      slot.venueName,
    );
  }

  @OnEvent(ReservationEvents.ReservationStatusChanged)
  async onStatusChanged(e: EventEnvelope<ReservationStatusChangedPayload>): Promise<void> {
    const p = e.payload;
    await this.reservations.applyStatusChanged(fact(p, p.to, new Date(p.occurredAt), null), p.depositOutcome);
  }
}
