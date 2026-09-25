import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Locale, Translatable } from '../../../shared/kernel/translatable';
import { BusyInterval } from '../domain/availability';
import { DepositOutcome, DepositState } from '../domain/deposit-policy';
import { CancelledBy, Reservation, ReservationProps, StatusChange } from '../domain/reservation';
import { BLOCKING_STATUSES } from '../domain/reservation-status';
import { VenueRules } from '../domain/venue-rules';
import { ReservationKind, ReservationSource, ReservationStatus } from '../public';
import { isOverlapViolation, isUniqueViolation } from './db-errors';
import { ReservationsTable, ReservationTables } from './reservation.tables';

/** Место брони для списков и карточек (снимок из справочника мест). */
export interface ReservationVenueRef {
  id: string;
  code: string;
  name: Translatable;
  hallId: string;
  hallName: Translatable;
  typeCode: string;
  typeName: Translatable;
}

export interface ReservationView {
  reservation: Reservation;
  venue: ReservationVenueRef;
}

export interface ReservationFilter {
  branchIds: 'all' | string[];
  /** Начало брони в [from, to). */
  from?: Date;
  to?: Date;
  statuses?: ReservationStatus[];
  kind?: ReservationKind;
  source?: ReservationSource;
  venueId?: string;
  hallId?: string;
  /** Номер, телефон (цифры) или имя гостя. */
  q?: string;
  /** Очередь «требует отметки»: подтверждённые обычные брони, начавшиеся к этому моменту. */
  needsMarkAt?: Date;
}

export interface StatusHistoryEntry {
  id: string;
  from: ReservationStatus | null;
  to: ReservationStatus;
  reason: string | null;
  depositOutcome: DepositOutcome;
  actorKind: string;
  actorUserId: string | null;
  actorName: string;
  occurredAt: Date;
}

const OVERLAP_MESSAGE = 'The venue is already occupied for this time';

function toProps(row: Selectable<ReservationsTable>): ReservationProps {
  return {
    id: row.id,
    number: row.number,
    branchId: row.branch_id,
    venueId: row.venue_id,
    kind: row.kind as ReservationKind,
    status: row.status as ReservationStatus,
    source: row.source as ReservationSource,
    start: row.start_at,
    end: row.end_at,
    blockedUntil: row.blocked_until,
    guests: row.guests,
    customer: { id: row.customer_id, name: row.customer_name, phone: row.customer_phone, email: row.customer_email },
    comment: row.comment,
    occasion: row.occasion,
    locale: row.locale as Locale,
    publicToken: row.public_token,
    idempotencyKey: row.idempotency_key,
    banquetRequestId: row.banquet_request_id,
    note: row.note,
    requiresConfirmation: row.requires_confirmation,
    rules: row.rules as VenueRules,
    holdExpiresAt: row.hold_expires_at,
    deposit: row.deposit_amount === null ? null : Money.of(row.deposit_amount, row.deposit_currency as Currency),
    depositState: row.deposit_status as DepositState,
    depositPaymentId: row.deposit_payment_id,
    depositPaidPaymentId: row.deposit_paid_payment_id,
    depositPaidAt: row.deposit_paid_at,
    depositWaiveReason: row.deposit_waive_reason,
    depositAttempts: row.deposit_attempts,
    depositOutcome: row.deposit_outcome as DepositOutcome,
    cancelReason: row.cancel_reason,
    cancelledBy: row.cancelled_by as CancelledBy | null,
    confirmedAt: row.confirmed_at,
    arrivedAt: row.arrived_at,
    noShowAt: row.no_show_at,
    cancelledAt: row.cancelled_at,
    expiredAt: row.expired_at,
    reminderSentAt: row.reminder_sent_at,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Изменяемые колонки (всё, кроме идентичности брони). */
function mutableColumns(p: ReservationProps) {
  return {
    venue_id: p.venueId,
    status: p.status,
    start_at: p.start,
    end_at: p.end,
    blocked_until: p.blockedUntil,
    guests: p.guests,
    customer_id: p.customer.id,
    customer_name: p.customer.name,
    customer_phone: p.customer.phone,
    customer_email: p.customer.email,
    comment: p.comment,
    occasion: p.occasion,
    note: p.note,
    requires_confirmation: p.requiresConfirmation,
    rules: JSON.stringify(p.rules),
    hold_expires_at: p.holdExpiresAt,
    deposit_amount: p.deposit?.amount ?? null,
    deposit_currency: p.deposit?.currency ?? 'KZT',
    deposit_status: p.depositState,
    deposit_payment_id: p.depositPaymentId,
    deposit_paid_payment_id: p.depositPaidPaymentId,
    deposit_paid_at: p.depositPaidAt,
    deposit_waive_reason: p.depositWaiveReason,
    deposit_attempts: p.depositAttempts,
    deposit_outcome: p.depositOutcome,
    cancel_reason: p.cancelReason,
    cancelled_by: p.cancelledBy,
    confirmed_at: p.confirmedAt,
    arrived_at: p.arrivedAt,
    no_show_at: p.noShowAt,
    cancelled_at: p.cancelledAt,
    expired_at: p.expiredAt,
    reminder_sent_at: p.reminderSentAt,
  };
}

/** Ошибки записи брони -> доменные исключения (exclusion constraint — вторая линия защиты от двойной брони). */
function mapWriteError(err: unknown): never {
  if (isOverlapViolation(err)) {
    throw new ConflictError('reservation.venue_occupied', OVERLAP_MESSAGE);
  }
  if (isUniqueViolation(err, 'reservations_idempotency_uq')) {
    throw new ConflictError('reservation.idempotency_conflict', 'A reservation with this idempotency key is being created');
  }
  throw err;
}

@Injectable()
export class ReservationRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReservationTables>();
  }

  async insert(r: Reservation): Promise<void> {
    const p = r.snapshot();
    try {
      await this.db()
        .insertInto('reservation.reservations')
        .values({
          id: p.id,
          number: p.number,
          branch_id: p.branchId,
          kind: p.kind,
          source: p.source,
          locale: p.locale,
          public_token: p.publicToken,
          idempotency_key: p.idempotencyKey,
          banquet_request_id: p.banquetRequestId,
          created_by_user_id: p.createdByUserId,
          created_at: p.createdAt,
          ...mutableColumns(p),
        })
        .execute();
    } catch (err) {
      mapWriteError(err);
    }
  }

  async update(r: Reservation): Promise<void> {
    const p = r.snapshot();
    try {
      await this.db().updateTable('reservation.reservations').set(mutableColumns(p)).where('id', '=', p.id).execute();
    } catch (err) {
      mapWriteError(err);
    }
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<Reservation | null> {
    let q = this.db().selectFrom('reservation.reservations').selectAll().where('id', '=', id).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? Reservation.restore(toProps(row)) : null;
  }

  async findByToken(token: string, options: { forUpdate?: boolean } = {}): Promise<Reservation | null> {
    let q = this.db().selectFrom('reservation.reservations').selectAll().where('public_token', '=', token).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? Reservation.restore(toProps(row)) : null;
  }

  async findByIdempotencyKey(key: string): Promise<Reservation | null> {
    const row = await this.db().selectFrom('reservation.reservations').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
    return row ? Reservation.restore(toProps(row)) : null;
  }

  /**
   * Бронь, занимающая место в пересекающемся интервале: [start, blockedUntil) && blocked_range.
   * Вызывается под блокировкой строки места — «выбрали, потом вставили» без блокировки недопустимо.
   */
  async findBlockingOverlap(venueId: string, start: Date, blockedUntil: Date, excludeId?: string | null): Promise<string | null> {
    let q = this.db()
      .selectFrom('reservation.reservations')
      .select('id')
      .where('venue_id', '=', venueId)
      .where('status', 'in', [...BLOCKING_STATUSES])
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`blocked_range && tstzrange(${start}::timestamptz, ${blockedUntil}::timestamptz, '[)')`);
    if (excludeId) q = q.where('id', '!=', excludeId);
    const row = await q.limit(1).executeTakeFirst();
    return row?.id ?? null;
  }

  /** Занятость мест (занимающие статусы), пересекающая [from, to). */
  async busyIntervals(venueIds: readonly string[], from: Date, to: Date): Promise<BusyInterval[]> {
    if (venueIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('reservation.reservations')
      .select(['id', 'venue_id', 'start_at', 'blocked_until'])
      .where('venue_id', 'in', [...venueIds])
      .where('status', 'in', [...BLOCKING_STATUSES])
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`blocked_range && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')`)
      .execute();
    return rows.map((r) => ({ reservationId: r.id, venueId: r.venue_id, start: r.start_at, blockedUntil: r.blocked_until }));
  }

  /** Брони с истёкшим удержанием (pending / awaiting_deposit). */
  async expiredHoldIds(now: Date, limit = 200): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('reservation.reservations')
      .select('id')
      .where('status', 'in', ['pending', 'awaiting_deposit'])
      .where('hold_expires_at', '<=', now)
      .where('deleted_at', 'is', null)
      .orderBy('hold_expires_at')
      .limit(limit)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Есть ли у места ещё не состоявшиеся брони (занимающие место), заканчивающиеся после now. */
  async hasUpcomingForVenue(venueId: string, now: Date): Promise<boolean> {
    const row = await this.db()
      .selectFrom('reservation.reservations')
      .select('id')
      .where('venue_id', '=', venueId)
      .where('status', 'in', [...BLOCKING_STATUSES])
      .where('end_at', '>', now)
      .where('deleted_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    return !!row;
  }

  async appendHistory(reservationId: string, change: Omit<StatusChange, 'to'> & { from: ReservationStatus | null; to: ReservationStatus }, actor: Actor): Promise<void> {
    await this.db()
      .insertInto('reservation.status_history')
      .values({
        id: newId(),
        reservation_id: reservationId,
        from_status: change.from,
        to_status: change.to,
        reason: change.reason,
        deposit_outcome: change.depositOutcome,
        actor_kind: actor.kind,
        actor_user_id: actor.userId,
        actor_name: actor.name,
        occurred_at: change.at,
      })
      .execute();
  }

  async history(reservationId: string): Promise<StatusHistoryEntry[]> {
    const rows = await this.db()
      .selectFrom('reservation.status_history')
      .selectAll()
      .where('reservation_id', '=', reservationId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      from: r.from_status as ReservationStatus | null,
      to: r.to_status as ReservationStatus,
      reason: r.reason,
      depositOutcome: r.deposit_outcome as DepositOutcome,
      actorKind: r.actor_kind,
      actorUserId: r.actor_user_id,
      actorName: r.actor_name,
      occurredAt: r.occurred_at,
    }));
  }

  private viewQuery() {
    return this.db()
      .selectFrom('reservation.reservations as r')
      .innerJoin('reservation.venues as v', 'v.id', 'r.venue_id')
      .innerJoin('reservation.halls as h', 'h.id', 'v.hall_id')
      .innerJoin('reservation.venue_types as t', 't.id', 'v.type_id')
      .selectAll('r')
      .select([
        'v.code as venue_code',
        'v.name as venue_name',
        'v.hall_id as venue_hall_id',
        'h.name as hall_name',
        't.code as type_code',
        't.name as type_name',
      ])
      .where('r.deleted_at', 'is', null);
  }

  private toView(row: Selectable<ReservationsTable> & {
    venue_code: string;
    venue_name: unknown;
    venue_hall_id: string;
    hall_name: unknown;
    type_code: string;
    type_name: unknown;
  }): ReservationView {
    return {
      reservation: Reservation.restore(toProps(row)),
      venue: {
        id: row.venue_id,
        code: row.venue_code,
        name: row.venue_name as Translatable,
        hallId: row.venue_hall_id,
        hallName: row.hall_name as Translatable,
        typeCode: row.type_code,
        typeName: row.type_name as Translatable,
      },
    };
  }

  async findView(id: string): Promise<ReservationView | null> {
    const row = await this.viewQuery().where('r.id', '=', id).executeTakeFirst();
    return row ? this.toView(row) : null;
  }

  async list(filter: ReservationFilter, page: PageRequest): Promise<Page<ReservationView>> {
    if (filter.branchIds !== 'all' && filter.branchIds.length === 0) return pageOf([], 0, page);
    let q = this.viewQuery();
    if (filter.branchIds !== 'all') q = q.where('r.branch_id', 'in', filter.branchIds);
    if (filter.from) q = q.where('r.start_at', '>=', filter.from);
    if (filter.to) q = q.where('r.start_at', '<', filter.to);
    if (filter.statuses && filter.statuses.length > 0) q = q.where('r.status', 'in', filter.statuses);
    if (filter.kind) q = q.where('r.kind', '=', filter.kind);
    if (filter.source) q = q.where('r.source', '=', filter.source);
    if (filter.venueId) q = q.where('r.venue_id', '=', filter.venueId);
    if (filter.hallId) q = q.where('v.hall_id', '=', filter.hallId);
    if (filter.needsMarkAt) {
      q = q.where('r.status', '=', 'confirmed').where('r.kind', '=', 'regular').where('r.start_at', '<=', filter.needsMarkAt);
    }
    if (filter.q) {
      const text = `%${filter.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const digits = filter.q.replace(/\D/g, '');
      q = q.where((eb) =>
        eb.or([
          eb('r.number', 'ilike', text),
          eb('r.customer_name', 'ilike', text),
          ...(digits.length >= 3 ? [eb('r.customer_phone', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    const total = await q
      .clearSelect()
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst();
    const rows = await q.orderBy('r.start_at').orderBy('r.id').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(
      rows.map((r) => this.toView(r)),
      Number(total?.n ?? 0),
      page,
    );
  }

  /** Брони филиала, пересекающие [from, to) (по интервалу занятости), для календаря и карты зала. */
  async timeline(branchId: string, from: Date, to: Date, statuses: readonly ReservationStatus[]): Promise<ReservationView[]> {
    const rows = await this.viewQuery()
      .where('r.branch_id', '=', branchId)
      .where('r.status', 'in', [...statuses])
      .where(sql<boolean>`r.blocked_range && tstzrange(${from}::timestamptz, ${to}::timestamptz, '[)')`)
      .orderBy('r.start_at')
      .orderBy('r.id')
      .execute();
    return rows.map((r) => this.toView(r));
  }

  /** Занятость мест филиала (занимающие статусы), пересекающая [from, to) по интервалу брони. */
  async occupancy(branchId: string, from: Date, to: Date): Promise<Reservation[]> {
    const rows = await this.db()
      .selectFrom('reservation.reservations')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('status', 'in', [...BLOCKING_STATUSES])
      .where('deleted_at', 'is', null)
      .where('start_at', '<', to)
      .where('end_at', '>', from)
      .orderBy('start_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => Reservation.restore(toProps(r)));
  }

  /** Обезличивание гостя (по требованию, закон РК о ПД): стираем контакты в снимках броней. */
  async anonymizeCustomer(customerId: string): Promise<number> {
    const result = await this.db()
      .updateTable('reservation.reservations')
      .set({ customer_name: null, customer_phone: null, customer_email: null, comment: null })
      .where('customer_id', '=', customerId)
      .executeTakeFirst();
    return Number(result.numUpdatedRows ?? 0);
  }
}
