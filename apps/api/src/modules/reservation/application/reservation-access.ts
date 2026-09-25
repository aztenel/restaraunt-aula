import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { Reservation } from '../domain/reservation';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { VenueDetails, VenueRepository } from '../infrastructure/venue.repository';

/** Загрузка брони для действий: права по филиалу, блокировка строки, контекст (филиал, место). */
@Injectable()
export class ReservationAccess {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly venues: VenueRepository,
    private readonly branches: BranchDirectory,
  ) {}

  /**
   * Бронь для действия сотрудника: право в филиале брони. Банкетной занятостью управляет модуль
   * банкетов (через контракт VenueAvailability), не админка броней.
   */
  async forStaff(actor: Actor, id: string, permission: Permission): Promise<Reservation> {
    const r = await this.reservations.findById(id);
    if (!r) throw new NotFoundError('reservation', id);
    actor.assertCan(permission, r.branchId);
    if (r.kind === 'banquet') {
      throw new ConflictError('reservation.banquet_hold', 'Banquet holds are managed in the banquet module', { banquetRequestId: r.banquetRequestId });
    }
    return r;
  }

  async get(id: string): Promise<Reservation> {
    const r = await this.reservations.findById(id);
    if (!r) throw new NotFoundError('reservation', id);
    return r;
  }

  /** Строка брони под блокировкой до конца транзакции (повторное чтение после проверки прав). */
  async lock(id: string): Promise<Reservation> {
    const r = await this.reservations.findById(id, { forUpdate: true });
    if (!r) throw new NotFoundError('reservation', id);
    return r;
  }

  async byToken(token: string): Promise<Reservation> {
    const r = await this.reservations.findByToken(token);
    if (!r) throw new NotFoundError('reservation');
    return r;
  }

  async context(r: Reservation): Promise<{ branch: BranchInfo; venue: VenueDetails }> {
    const branch = await this.branches.get(r.branchId);
    const venue = await this.venueOf(r.venueId);
    return { branch, venue };
  }

  /** Место брони (в том числе удалённое из справочника — для истории). */
  async venueOf(venueId: string): Promise<VenueDetails> {
    const venue = await this.venues.findDetailed(venueId, { includeDeleted: true });
    if (!venue) throw new NotFoundError('venue', venueId);
    return venue;
  }
}
