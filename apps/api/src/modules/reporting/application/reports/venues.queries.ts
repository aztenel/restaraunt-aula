import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { BranchDirectory } from '../../../identity/public';
import { VenueAvailability } from '../../../reservation/public';
import { BanquetFunnel, computeBanquetFunnel } from '../../domain/banquet-funnel';
import { computeHallLoad, findOverbookings, HallLoadRow, HallLoadWeekday, LoadBranch, LoadVenue } from '../../domain/hall-load';
import { datesOf, ReportPeriod } from '../../domain/period';
import { BanquetFactsRepository } from '../../infrastructure/banquet-facts.repository';
import { OccupyingReservationRow, ReservationFactsRepository } from '../../infrastructure/reservation-facts.repository';
import { Clock } from '../../../../shared/kernel/clock';
import { ReportScope, ReportScopes } from '../report-scope';
import { header, PeriodQuery, ReportHeader } from './sales.queries';

// ---------------------------------------------------------------- Загрузка залов

export interface OverbookingView {
  venueId: string;
  branchId: string;
  venueTypeCode: string;
  first: Pick<OccupyingReservationRow, 'reservationId' | 'number' | 'status' | 'start' | 'end'>;
  second: Pick<OccupyingReservationRow, 'reservationId' | 'number' | 'status' | 'start' | 'end'>;
}

export interface HallLoadReportView extends ReportHeader {
  rows: HallLoadRow[];
  weekdays: HallLoadWeekday[];
  /** Накладки: пересечения действующих броней одного места (цель ТЗ — 0). */
  overbookingCount: number;
  overbookings: OverbookingView[];
}

function brief(r: OccupyingReservationRow) {
  return { reservationId: r.reservationId, number: r.number, status: r.status, start: r.start, end: r.end };
}

/**
 * Загрузка залов по дням недели в разрезе типа места: занятое бронями время / время работы
 * филиала × число активных мест типа (места — из публичного сервиса Reservation, часы — Identity).
 */
@Injectable()
export class HallLoadReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly reservations: ReservationFactsRepository,
    private readonly branches: BranchDirectory,
    private readonly venues: VenueAvailability,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<HallLoadReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<HallLoadReportView> {
    const branchInfos = scope.branchIds
      ? await Promise.all(scope.branchIds.map((id) => this.branches.get(id)))
      : await this.branches.list({ activeOnly: true });
    const loadBranches: LoadBranch[] = branchInfos.map((b) => ({ branchId: b.id, openingHours: b.openingHours }));
    const loadVenues: LoadVenue[] = [];
    for (const branch of branchInfos) {
      for (const venue of await this.venues.listVenues(branch.id)) {
        if (!venue.isActive) continue;
        loadVenues.push({ venueId: venue.id, branchId: venue.branchId, typeCode: venue.typeCode, typeName: venue.typeName });
      }
    }
    const reservations = await this.reservations.occupying(period, scope.branchIds);
    const load = computeHallLoad({ dates: datesOf(period), branches: loadBranches, venues: loadVenues, reservations });
    const overbookings = findOverbookings(reservations).map(([a, b]) => ({
      venueId: a.venueId,
      branchId: a.branchId,
      venueTypeCode: a.venueTypeCode,
      first: brief(a),
      second: brief(b),
    }));
    return { ...header(period, scope), ...load, overbookingCount: overbookings.length, overbookings };
  }
}

// ---------------------------------------------------------------- Воронка банкетов

export interface BanquetFunnelReportView extends ReportHeader, BanquetFunnel {}

/** Воронка банкетных заявок, созданных в периоде: стадии, конверсия, ответ за 30 минут, потери. */
@Injectable()
export class BanquetFunnelReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly banquets: BanquetFactsRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<BanquetFunnelReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<BanquetFunnelReportView> {
    const rows = await this.banquets.funnelRows(period, scope.branchIds);
    return { ...header(period, scope), ...computeBanquetFunnel(rows, this.clock.now()) };
  }
}
