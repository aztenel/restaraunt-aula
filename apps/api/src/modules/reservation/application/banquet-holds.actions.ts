import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../shared/infrastructure/context/request-context';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { addMinutes, TimeRange } from '../../../shared/kernel/time';
import { normalizeFreeText } from '../domain/contact';
import { Reservation } from '../domain/reservation';
import { assertCapacity } from '../domain/venue';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { BookingContext } from './booking-context';
import { MoveReservationSlot } from './move-reservation-slot';
import { ReservationAccess } from './reservation-access';
import { ReservationNumbers } from './reservation-numbers';
import { ReservationRecorder } from './reservation-recorder';
import { SlotGuard } from './slot-guard';

/**
 * Занятость зала под банкет (контракт VenueAvailability для модуля Banquet): вид брони banquet,
 * статус confirmed, ссылка на банкетную заявку. Тот же механизм, что и обычная бронь: блокировка
 * места, проверка пересечений (включая буфер уборки), exclusion constraint — зал не может быть
 * одновременно занят банкетом и обычной бронью. Вместимость проверяется по верхней границе.
 */
function contractActor(): Actor {
  return RequestContext.actor() ?? Actor.system('banquet');
}

async function banquetHold(access: ReservationAccess, id: string, options: { lock: boolean }): Promise<Reservation> {
  const r = options.lock ? await access.lock(id) : await access.get(id);
  if (r.kind !== 'banquet') throw new ConflictError('reservation.not_banquet_hold', 'Reservation is not a banquet hold', { id });
  return r;
}

@Injectable()
export class HoldVenueForBanquet {
  constructor(
    private readonly context: BookingContext,
    private readonly reservations: ReservationRepository,
    private readonly guard: SlotGuard,
    private readonly numbers: ReservationNumbers,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    venueId: string;
    start: Date;
    end: Date;
    guests: number;
    banquetRequestId: string;
    note?: string | null;
  }): Promise<{ reservationId: string }> {
    const venue = await this.context.venue(input.venueId);
    if (!venue.isActive || !venue.hall.isActive || !venue.type.isActive) {
      throw new ValidationError('reservation.venue_unavailable', 'Venue is not available for booking');
    }
    const range = new TimeRange(input.start, input.end);
    assertCapacity(input.guests, venue.capacityMin, venue.capacityMax, { checkMinimum: false });
    const branch = await this.context.branch(venue.branchId);
    const actor = contractActor();
    return this.database.transaction(async () => {
      const now = this.clock.now();
      await this.guard.lock([venue.id]);
      await this.guard.assertFree(venue.id, range.start, addMinutes(range.end, venue.rules.cleanupMinutes));
      const reservation = Reservation.create(
        {
          id: newId(),
          number: await this.numbers.next(branch, now),
          branchId: branch.id,
          venueId: venue.id,
          kind: 'banquet',
          source: 'banquet',
          start: range.start,
          end: range.end,
          rules: venue.rules,
          guests: input.guests,
          customer: { id: null, name: null, phone: null, email: null },
          locale: 'ru',
          publicToken: null,
          idempotencyKey: null,
          banquetRequestId: input.banquetRequestId,
          note: normalizeFreeText(input.note, 'note'),
          requiresConfirmation: false,
          deposit: null,
          createdByUserId: actor.userId,
        },
        now,
      );
      await this.reservations.insert(reservation);
      await this.recorder.created(reservation, { actor, branch, venue });
      return { reservationId: reservation.id };
    });
  }
}

/** Перенос банкетной занятости (другой зал того же филиала, время, гости). Повтор без изменений — ничего не делает. */
@Injectable()
export class MoveBanquetHold {
  constructor(
    private readonly access: ReservationAccess,
    private readonly move: MoveReservationSlot,
  ) {}

  async execute(reservationId: string, input: { venueId: string; start: Date; end: Date; guests: number }): Promise<void> {
    const r = await banquetHold(this.access, reservationId, { lock: false });
    const same =
      r.venueId === input.venueId && r.start.getTime() === input.start.getTime() && r.end.getTime() === input.end.getTime() && r.guests === input.guests;
    if (same && r.status === 'confirmed') return;
    await this.move.execute({ reservationId, ...input, reason: null, actor: contractActor(), channel: 'banquet' });
  }
}

/** Освобождение зала (банкет отменён или перенесён в другой филиал): -> cancelled. Идемпотентно. */
@Injectable()
export class ReleaseBanquetHold {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(reservationId: string, reason: string): Promise<void> {
    await this.database.transaction(async () => {
      const r = await banquetHold(this.access, reservationId, { lock: true });
      if (r.status === 'cancelled') return;
      const before = r.auditState();
      const { change, resolution } = r.cancel({ now: this.clock.now(), by: 'banquet', reason: normalizeFreeText(reason, 'reason', 500) });
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, { ...ctx, actor: contractActor(), before, paymentReason: 'banquet_released' });
    });
  }
}
