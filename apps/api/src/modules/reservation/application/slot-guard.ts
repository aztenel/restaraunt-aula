import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { ConflictError, InvariantViolationError } from '../../../shared/kernel/errors';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { VenueRepository } from '../infrastructure/venue.repository';

/**
 * Конкурентная бронь (ТЗ): проверка занятости и вставка — в одной транзакции с блокировкой по месту.
 * lock() берёт select ... for update на строки мест (порядок — по id), assertFree() проверяет пересечение
 * интервала занятости [начало, конец + уборка) с занимающими бронями. Вставку/перенос после этого
 * дополнительно страхует exclusion constraint в БД (23P01 -> 'reservation.venue_occupied').
 */
@Injectable()
export class SlotGuard {
  constructor(
    private readonly database: Database,
    private readonly venues: VenueRepository,
    private readonly reservations: ReservationRepository,
  ) {}

  async lock(venueIds: readonly string[]): Promise<void> {
    if (!this.database.inTransaction()) {
      throw new InvariantViolationError('reservation.lock_outside_transaction', 'Venue lock must be taken inside a transaction');
    }
    await this.venues.lockForUpdate(venueIds);
  }

  async assertFree(venueId: string, start: Date, blockedUntil: Date, excludeReservationId?: string | null): Promise<void> {
    const conflicting = await this.reservations.findBlockingOverlap(venueId, start, blockedUntil, excludeReservationId);
    if (conflicting) {
      throw new ConflictError('reservation.venue_occupied', 'The venue is already occupied for this time', { venueId });
    }
  }
}
