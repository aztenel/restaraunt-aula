import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { addDays, isHhMm, isIsoDate, zonedTimeToUtc } from '../../../shared/kernel/time';
import { translate } from '../../../shared/kernel/translatable';
import { VenueAvailability } from '../../reservation/public';
import { BanquetRequest } from '../domain/banquet-request';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { assertCanManage } from './access';
import { BanquetSupport } from './banquet-support';

export interface SetVenueInput {
  venueId: string;
  /** Локальная дата начала (по умолчанию — дата мероприятия). */
  date?: string | null;
  /** Локальное время начала и окончания 'HH:mm'; окончание раньше начала — следующий день. */
  startTime: string;
  endTime: string;
}

/** Максимальная длительность занятости зала под банкет. */
const MAX_HOLD_HOURS = 24;

/**
 * Зал и время банкета в филиале: занятость ставится сразу через модуль Reservation (вид брони banquet),
 * поэтому зал не может быть одновременно занят банкетом и обычной бронью. Повторная установка переносит
 * занятость. Конфликт (зал занят) — ConflictError 409 от модуля Reservation.
 */
@Injectable()
export class SetBanquetVenue {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly venues: VenueAvailability,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: SetVenueInput): Promise<BanquetRequest> {
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      request.assertOpen();
      const s = request.snapshot();
      if (s.isOffsite || !s.branchId) {
        throw new ValidationError('banquet.venue_requires_branch', 'Venue can be set only for a request in a branch (not offsite catering)');
      }
      const venue = await this.venues.getVenue(input.venueId);
      if (venue.branchId !== s.branchId) {
        throw new ValidationError('banquet.venue_other_branch', 'Venue belongs to another branch', { venueId: venue.id });
      }
      if (!venue.isActive) throw new ValidationError('banquet.venue_inactive', 'Venue is not active');
      const date = input.date ?? s.eventDate;
      if (!isIsoDate(date) || !isHhMm(input.startTime) || !isHhMm(input.endTime)) {
        throw new ValidationError('banquet.venue_time_invalid', 'Expected date YYYY-MM-DD and times HH:mm');
      }
      const tz = await this.support.timezoneOf(s.branchId);
      const start = zonedTimeToUtc(date, input.startTime, tz);
      const endDate = input.endTime <= input.startTime ? addDays(date, 1) : date;
      const end = zonedTimeToUtc(endDate, input.endTime, tz);
      if (end.getTime() - start.getTime() > MAX_HOLD_HOURS * 3_600_000) {
        throw new ValidationError('banquet.venue_time_invalid', `Venue hold cannot exceed ${MAX_HOLD_HOURS} hours`);
      }
      const before = request.auditView();
      let reservationId: string;
      if (s.venue) {
        await this.venues.moveBanquetHold(s.venue.reservationId, { venueId: venue.id, start, end, guests: s.guests });
        reservationId = s.venue.reservationId;
      } else {
        reservationId = (
          await this.venues.holdForBanquet({
            venueId: venue.id,
            start,
            end,
            guests: s.guests,
            banquetRequestId: id,
            note: `Банкет ${s.number}: ${s.contact.name}`,
          })
        ).reservationId;
      }
      request.setVenue({ venueId: venue.id, reservationId, start, end });
      await this.requests.save(request);
      const now = this.clock.now();
      await this.activities.add({
        requestId: id,
        kind: 'venue_set',
        data: { venueId: venue.id, venueName: translate(venue.name, 'ru'), start: start.toISOString(), end: end.toISOString() },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.venue_set',
        entityType: 'banquet_request',
        entityId: id,
        branchId: s.branchId,
        before: { venue: before.venue },
        after: { venue: request.auditView().venue },
        meta: { number: s.number, reservationId },
        actor,
      });
      return request;
    });
  }
}

/** Освободить зал (занятость в модуле Reservation снимается). */
@Injectable()
export class ReleaseBanquetVenue {
  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly venues: VenueAvailability,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<BanquetRequest> {
    return this.database.transaction(async () => {
      const request = await this.support.load(id, { forUpdate: true });
      assertCanManage(actor, request);
      request.assertOpen();
      const venue = request.snapshot().venue;
      if (!venue) return request;
      const before = request.auditView();
      await this.venues.releaseBanquetHold(venue.reservationId, `Зал освобождён менеджером (заявка ${request.number})`);
      request.setVenue(null);
      await this.requests.save(request);
      await this.activities.add({ requestId: id, kind: 'venue_released', data: { venueId: venue.venueId }, actor, at: this.clock.now() });
      await this.audit.record({
        action: 'banquet.venue_released',
        entityType: 'banquet_request',
        entityId: id,
        branchId: request.branchId,
        before: { venue: before.venue },
        after: { venue: null },
        meta: { number: request.number, reservationId: venue.reservationId },
        actor,
      });
      return request;
    });
  }
}
