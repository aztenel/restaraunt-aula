import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { addMinutes, TimeRange } from '../../../shared/kernel/time';
import { assertSlotAllowed, assertVenueBookable } from '../domain/booking';
import { Reservation } from '../domain/reservation';
import { assertCapacity } from '../domain/venue';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { BookingContext, bookableOf } from './booking-context';
import { ReservationAccess } from './reservation-access';
import { ReservationRecorder } from './reservation-recorder';
import { SlotGuard } from './slot-guard';

export interface MoveSlotInput {
  reservationId: string;
  venueId: string;
  start: Date;
  end: Date;
  guests: number;
  reason: string | null;
  actor: Actor;
  /** admin — перенос брони оператором (часы работы, окно брони); banquet — перенос банкетной занятости. */
  channel: 'admin' | 'banquet';
}

/**
 * Перенос брони или банкетной занятости на другое место / время / число гостей — с той же защитой,
 * что и новая бронь: блокировка строк обоих мест (по id), проверка пересечения без учёта самой брони,
 * exclusion constraint при записи. Статус и депозит не меняются; событие ReservationRescheduled.
 */
@Injectable()
export class MoveReservationSlot {
  constructor(
    private readonly context: BookingContext,
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly guard: SlotGuard,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: MoveSlotInput): Promise<Reservation> {
    const current = await this.access.get(input.reservationId);
    const range = new TimeRange(input.start, input.end);
    const target = await this.context.venue(input.venueId);
    const branch = await this.context.branch(current.branchId);
    assertVenueBookable(bookableOf(target), current.branchId, 'admin');
    assertCapacity(input.guests, target.capacityMin, target.capacityMax, { checkMinimum: false });
    const timeChanged = range.start.getTime() !== current.start.getTime() || range.end.getTime() !== current.end.getTime();
    if (current.venueId === target.id && !timeChanged && input.guests === current.guests) {
      throw new ValidationError('reservation.nothing_to_change', 'New venue, time or guests must differ from the current ones');
    }
    if (input.channel === 'admin' && timeChanged) {
      assertSlotAllowed(range, await this.context.window(branch, 'admin'));
    }

    return this.database.transaction(async () => {
      await this.guard.lock([current.venueId, target.id]);
      const r = await this.access.lock(input.reservationId);
      if (r.venueId !== current.venueId) {
        throw new ConflictError('reservation.concurrent_change', 'Reservation was changed concurrently, retry');
      }
      await this.guard.assertFree(target.id, range.start, addMinutes(range.end, target.rules.cleanupMinutes), r.id);
      const before = r.auditState();
      const beforeVenue = await this.access.venueOf(r.venueId);
      const change = r.reschedule({ venueId: target.id, start: range.start, end: range.end, rules: target.rules, guests: input.guests }, this.clock.now());
      await this.reservations.update(r);
      await this.recorder.rescheduled(r, change, {
        actor: input.actor,
        branch,
        venues: { before: beforeVenue, after: target },
        before,
        reason: input.reason,
      });
      return r;
    });
  }
}
