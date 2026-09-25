import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { localDateTime, slotRange } from '../domain/availability';
import { normalizeFreeText } from '../domain/contact';
import { Reservation } from '../domain/reservation';
import { BookingContext } from './booking-context';
import { MoveReservationSlot } from './move-reservation-slot';
import { ReservationAccess } from './reservation-access';

export interface RescheduleReservationInput {
  venueId?: string | null;
  /** Новые локальные дата / время начала (по умолчанию — текущие). */
  date?: string | null;
  time?: string | null;
  durationMinutes?: number | null;
  guests?: number | null;
  reason?: string | null;
}

/**
 * Перенос брони оператором: другое место (пересадка), время, длительность или число гостей.
 * Только для ещё не состоявшихся броней (pending, awaiting_deposit, confirmed); та же блокировка
 * и проверка пересечений, что при создании.
 */
@Injectable()
export class RescheduleReservation {
  constructor(
    private readonly access: ReservationAccess,
    private readonly context: BookingContext,
    private readonly move: MoveReservationSlot,
  ) {}

  async execute(actor: Actor, id: string, input: RescheduleReservationInput): Promise<Reservation> {
    const r = await this.access.forStaff(actor, id, Permission.ReservationsManage);
    if (!r.canReschedule()) {
      throw new ConflictError('reservation.cannot_reschedule', `Reservation in status ${r.status} cannot be moved`, { status: r.status });
    }
    const branch = await this.context.branch(r.branchId);
    const current = localDateTime(r.start, branch.timezone);
    const duration = input.durationMinutes ?? Math.round((r.end.getTime() - r.start.getTime()) / 60_000);
    const range = slotRange(input.date ?? current.date, input.time ?? current.time, branch.timezone, duration);
    return this.move.execute({
      reservationId: id,
      venueId: input.venueId ?? r.venueId,
      start: range.start,
      end: range.end,
      guests: input.guests ?? r.guests,
      reason: normalizeFreeText(input.reason, 'reason', 500),
      actor,
      channel: 'admin',
    });
  }
}
