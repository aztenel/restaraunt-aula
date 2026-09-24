import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { OCCUPYING_RESERVATION_STATUSES } from '../domain/hall-load';
import { ReportPeriod } from '../domain/period';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod, whenNewer } from './sql-helpers';

const T = 'reporting.reservations';

export interface ReservationFact {
  reservationId: string;
  number: string;
  branchId: string;
  venueId: string;
  venueTypeCode: string;
  kind: string;
  status: string;
  statusAt: Date;
  statusRank: number;
  start: Date;
  end: Date;
  startDate: string;
  guests: number;
  banquetRequestId: string | null;
  deposit: Money | null;
}

export interface OccupyingReservationRow {
  reservationId: string;
  number: string;
  branchId: string;
  venueId: string;
  venueTypeCode: string;
  status: string;
  start: Date;
  end: Date;
  startDate: string;
  guests: number;
}

/** Проекция броней (события Reservation): загрузка залов, накладки, количество броней. */
@Injectable()
export class ReservationFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  private row(f: ReservationFact) {
    return {
      reservation_id: f.reservationId,
      number: f.number,
      branch_id: f.branchId,
      venue_id: f.venueId,
      venue_type_code: f.venueTypeCode,
      kind: f.kind,
      status: f.status,
      status_at: f.statusAt,
      status_rank: f.statusRank,
      start_at: f.start,
      end_at: f.end,
      start_date: f.startDate,
      guests: f.guests,
      banquet_request_id: f.banquetRequestId,
      deposit_amount: f.deposit?.amount ?? null,
      deposit_currency: f.deposit?.currency ?? 'KZT',
    };
  }

  /** Интервал, гости и место — из более нового события (перенос банкета, смена места). */
  private newerSet() {
    return Object.fromEntries(
      ['status', 'status_at', 'status_rank', 'venue_id', 'venue_type_code', 'start_at', 'end_at', 'start_date', 'guests'].map((c) => [
        c,
        whenNewer(T, c),
      ]),
    ) as Record<string, never>;
  }

  async applyCreated(f: ReservationFact, created: { venueName: Translatable; source: string; bookedAt: Date; bookedDate: string }) {
    await this.db()
      .insertInto(T)
      .values({
        ...this.row(f),
        venue_name: JSON.stringify(created.venueName),
        source: created.source,
        booked_at: created.bookedAt,
        booked_date: created.bookedDate,
      })
      .onConflict((oc) =>
        oc.column('reservation_id').doUpdateSet({
          ...this.newerSet(),
          number: sql<string>`excluded.number`,
          branch_id: sql<string>`excluded.branch_id`,
          kind: sql<string>`excluded.kind`,
          venue_name: sql`excluded.venue_name`,
          source: sql<string>`excluded.source`,
          banquet_request_id: sql`coalesce(excluded.banquet_request_id, ${sql.ref(`${T}.banquet_request_id`)})` as never,
          deposit_amount: sql`coalesce(${sql.ref(`${T}.deposit_amount`)}, excluded.deposit_amount)` as never,
          booked_at: sql<Date>`excluded.booked_at`,
          booked_date: sql<string>`excluded.booked_date`,
        }),
      )
      .execute();
  }

  async applyStatusChanged(f: ReservationFact, depositOutcome: string) {
    await this.db()
      .insertInto(T)
      .values({ ...this.row(f), deposit_outcome: depositOutcome })
      .onConflict((oc) =>
        oc.column('reservation_id').doUpdateSet({
          ...this.newerSet(),
          deposit_outcome: sql`case when excluded.deposit_outcome <> 'none' then excluded.deposit_outcome else ${sql.ref(
            `${T}.deposit_outcome`,
          )} end` as never,
          deposit_amount: sql`coalesce(excluded.deposit_amount, ${sql.ref(`${T}.deposit_amount`)})` as never,
        }),
      )
      .execute();
  }

  /** Перенос: другое место, время или число гостей (снимок на момент события, статус не меняется). */
  async applyRescheduled(f: ReservationFact, venueName: Translatable): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({ ...this.row(f), venue_name: JSON.stringify(venueName) })
      .onConflict((oc) =>
        oc.column('reservation_id').doUpdateSet({
          ...this.newerSet(),
          venue_name: sql`case when excluded.status_at >= ${sql.ref(`${T}.status_at`)} then excluded.venue_name else ${sql.ref(
            `${T}.venue_name`,
          )} end` as never,
        }),
      )
      .execute();
  }

  // ---------------------------------------------------------------- отчёты

  /** Брони, занимавшие место (для загрузки залов и накладок), с началом в периоде. */
  async occupying(period: ReportPeriod, branchIds: readonly string[] | null): Promise<OccupyingReservationRow[]> {
    const rows = await this.db()
      .selectFrom(T)
      .select(['reservation_id', 'number', 'branch_id', 'venue_id', 'venue_type_code', 'status', 'start_at', 'end_at', 'start_date', 'guests'])
      .where('status', 'in', [...OCCUPYING_RESERVATION_STATUSES])
      .where(inPeriod('start_date', period))
      .where(branchFilter('branch_id', branchIds))
      .orderBy('start_at')
      .execute();
    return rows.map((r) => ({
      reservationId: r.reservation_id,
      number: r.number,
      branchId: r.branch_id,
      venueId: r.venue_id,
      venueTypeCode: r.venue_type_code,
      status: r.status,
      start: r.start_at,
      end: r.end_at,
      startDate: r.start_date,
      guests: r.guests,
    }));
  }

  /** Новые брони (по дате оформления) и брони с началом в периоде. */
  async counts(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ created: number; guests: number; starting: number }>`
      select
        count(*) filter (where kind = 'regular' and ${inPeriod('booked_date', period)}) as created,
        coalesce(sum(guests) filter (where kind = 'regular' and ${inPeriod('booked_date', period)}), 0)::bigint as guests,
        count(*) filter (where ${inPeriod('start_date', period)} and status in (${sql.join([...OCCUPYING_RESERVATION_STATUSES])})) as starting
      from reporting.reservations
      where ${branchFilter('branch_id', branchIds)}
        and (${inPeriod('booked_date', period)} or ${inPeriod('start_date', period)})
    `.execute(this.db());
    const r = result.rows[0]!;
    return { created: Number(r.created), guests: Number(r.guests), starting: Number(r.starting) };
  }
}
