import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { Locale } from '../../../shared/kernel/translatable';
import { ManagerLoad } from '../domain/assignment';
import { OPEN_BANQUET_STATUSES } from '../domain/banquet-status';
import { BanquetRequest, BanquetRequestState, BanquetSource } from '../domain/banquet-request';
import { BanquetEventType } from '../domain/texts';
import { BanquetStatus } from '../public';
import { BanquetTables, RequestsTable } from './banquet.tables';

const T = 'banquet.requests' as const;

function money(amount: number | null, currency: string): Money | null {
  return amount === null ? null : Money.of(amount, currency as Currency);
}

export function mapRequest(row: Selectable<RequestsTable>): BanquetRequest {
  const state: BanquetRequestState = {
    id: row.id,
    number: row.number,
    status: row.status as BanquetStatus,
    source: row.source as BanquetSource,
    branchId: row.branch_id,
    isOffsite: row.is_offsite,
    offsiteAddress: row.offsite_address,
    eventDate: row.event_date,
    eventTime: row.event_time,
    eventType: row.event_type as BanquetEventType,
    guests: row.guests,
    budget: money(row.budget_amount, row.budget_currency),
    contact: { customerId: row.customer_id, name: row.contact_name, phone: row.contact_phone, email: row.contact_email },
    wishes: row.wishes,
    locale: row.locale as Locale,
    managerId: row.manager_id,
    assignedAt: row.assigned_at,
    companyId: row.company_id,
    prepaymentAmount: money(row.prepayment_amount, row.prepayment_currency),
    prepaymentIsCustom: row.prepayment_is_custom,
    venue:
      row.venue_id && row.venue_reservation_id && row.venue_start && row.venue_end
        ? { venueId: row.venue_id, reservationId: row.venue_reservation_id, start: row.venue_start, end: row.venue_end }
        : null,
    contractNumber: row.contract_number,
    contractDate: row.contract_date,
    firstResponseAt: row.first_response_at,
    slaBreachedAt: row.sla_breached_at,
    cancelReason: row.cancel_reason,
    heldAt: row.held_at,
    cancelledAt: row.cancelled_at,
    publicToken: row.public_token,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return new BanquetRequest(state);
}

function toRow(s: Readonly<BanquetRequestState>) {
  return {
    number: s.number,
    status: s.status,
    source: s.source,
    branch_id: s.branchId,
    is_offsite: s.isOffsite,
    offsite_address: s.offsiteAddress,
    event_date: s.eventDate,
    event_time: s.eventTime,
    event_type: s.eventType,
    guests: s.guests,
    budget_amount: s.budget?.amount ?? null,
    budget_currency: s.budget?.currency ?? 'KZT',
    customer_id: s.contact.customerId,
    contact_name: s.contact.name,
    contact_phone: s.contact.phone,
    contact_email: s.contact.email,
    wishes: s.wishes,
    locale: s.locale,
    manager_id: s.managerId,
    assigned_at: s.assignedAt,
    company_id: s.companyId,
    prepayment_amount: s.prepaymentAmount?.amount ?? null,
    prepayment_currency: s.prepaymentAmount?.currency ?? 'KZT',
    prepayment_is_custom: s.prepaymentIsCustom,
    venue_id: s.venue?.venueId ?? null,
    venue_reservation_id: s.venue?.reservationId ?? null,
    venue_start: s.venue?.start ?? null,
    venue_end: s.venue?.end ?? null,
    contract_number: s.contractNumber,
    contract_date: s.contractDate,
    first_response_at: s.firstResponseAt,
    sla_breached_at: s.slaBreachedAt,
    cancel_reason: s.cancelReason,
    held_at: s.heldAt,
    cancelled_at: s.cancelledAt,
    public_token: s.publicToken,
  };
}

export interface RequestFilter {
  /** 'all' или список филиалов; includeOffsiteWithoutBranch — видны выезды без филиала-исполнителя (глобальные роли). */
  branches: 'all' | string[];
  statuses?: BanquetStatus[];
  managerId?: string;
  eventDateFrom?: string;
  eventDateTo?: string;
  q?: string;
  isOffsite?: boolean;
  slaBreached?: boolean;
}

@Injectable()
export class RequestRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<BanquetRequest | null> {
    let q = this.db().selectFrom(T).selectAll().where('id', '=', id).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapRequest(row) : null;
  }

  async findByToken(token: string): Promise<BanquetRequest | null> {
    const row = await this.db().selectFrom(T).selectAll().where('public_token', '=', token).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapRequest(row) : null;
  }

  async findByIds(ids: string[]): Promise<BanquetRequest[]> {
    if (ids.length === 0) return [];
    const rows = await this.db().selectFrom(T).selectAll().where('id', 'in', ids).execute();
    return rows.map(mapRequest);
  }

  async insert(request: BanquetRequest): Promise<void> {
    const s = request.snapshot();
    await this.db()
      .insertInto(T)
      .values({ id: s.id, ...toRow(s), created_at: s.createdAt, deleted_at: null })
      .execute();
  }

  async save(request: BanquetRequest): Promise<void> {
    const s = request.snapshot();
    await this.db().updateTable(T).set(toRow(s)).where('id', '=', s.id).execute();
  }

  private filtered(filter: RequestFilter) {
    let q = this.db().selectFrom(T).where('deleted_at', 'is', null);
    if (filter.branches !== 'all') {
      if (filter.branches.length === 0) return q.where(sql<boolean>`false`);
      q = q.where('branch_id', 'in', filter.branches);
    }
    if (filter.statuses && filter.statuses.length > 0) q = q.where('status', 'in', filter.statuses);
    if (filter.managerId) q = q.where('manager_id', '=', filter.managerId);
    if (filter.eventDateFrom) q = q.where('event_date', '>=', filter.eventDateFrom);
    if (filter.eventDateTo) q = q.where('event_date', '<=', filter.eventDateTo);
    if (filter.isOffsite !== undefined) q = q.where('is_offsite', '=', filter.isOffsite);
    if (filter.slaBreached !== undefined) {
      q = filter.slaBreached ? q.where('sla_breached_at', 'is not', null) : q.where('sla_breached_at', 'is', null);
    }
    if (filter.q?.trim()) {
      const term = `%${filter.q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const digits = filter.q.replace(/\D/g, '');
      q = q.where((eb) =>
        eb.or([
          eb(sql`lower(number)`, 'like', term),
          eb(sql`lower(contact_name)`, 'like', term),
          ...(digits.length >= 4 ? [eb('contact_phone', 'like', `%${digits}%`)] : []),
        ]),
      );
    }
    return q;
  }

  async list(filter: RequestFilter, page: PageRequest): Promise<{ items: BanquetRequest[]; total: number }> {
    const q = this.filtered(filter);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll()
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return { items: rows.map(mapRequest), total: Number(total?.n ?? 0) };
  }

  /** Воронка: количество по статусам и последние заявки каждого статуса. */
  async countByStatus(filter: RequestFilter): Promise<Map<BanquetStatus, number>> {
    const rows = await this.filtered(filter)
      .select(['status', (eb) => eb.fn.countAll<number>().as('n')])
      .groupBy('status')
      .execute();
    return new Map(rows.map((r) => [r.status as BanquetStatus, Number(r.n)]));
  }

  async latestByStatus(filter: RequestFilter, status: BanquetStatus, limit: number): Promise<BanquetRequest[]> {
    const rows = await this.filtered({ ...filter, statuses: [status] })
      .selectAll()
      .orderBy('event_date', 'asc')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .execute();
    return rows.map(mapRequest);
  }

  /**
   * Заявки календаря филиала: дата мероприятия в интервале локальных дат [from, to]
   * или занятость зала пересекает интервал [fromUtc, toUtc).
   */
  async forCalendar(branchId: string, range: { from: string; to: string; fromUtc: Date; toUtc: Date }): Promise<BanquetRequest[]> {
    const rows = await this.db()
      .selectFrom(T)
      .selectAll()
      .where('deleted_at', 'is', null)
      .where('branch_id', '=', branchId)
      .where('status', '!=', 'cancelled')
      .where((eb) =>
        eb.or([
          eb.and([eb('event_date', '>=', range.from), eb('event_date', '<=', range.to)]),
          eb.and([eb('venue_start', '<', range.toUtc), eb('venue_end', '>', range.fromUtc)]),
        ]),
      )
      .orderBy('event_date')
      .orderBy('event_time')
      .execute();
    return rows.map(mapRequest);
  }

  /** Нагрузка менеджеров: открытые заявки и время последнего назначения. */
  async managerLoads(managerIds: string[]): Promise<Map<string, ManagerLoad>> {
    if (managerIds.length === 0) return new Map();
    const rows = await this.db()
      .selectFrom(T)
      .select([
        'manager_id',
        sql<number>`count(*) filter (where status in (${sql.join(OPEN_BANQUET_STATUSES)}))`.as('open'),
        sql<Date | null>`max(assigned_at)`.as('last_assigned_at'),
      ])
      .where('manager_id', 'in', managerIds)
      .where('deleted_at', 'is', null)
      .groupBy('manager_id')
      .execute();
    return new Map(
      rows.map((r) => [
        r.manager_id,
        { managerId: r.manager_id, openRequests: Number(r.open), lastAssignedAt: r.last_assigned_at ? new Date(r.last_assigned_at) : null },
      ]),
    );
  }

  /** Новые заявки без ответа, созданные до момента, ещё не отмеченные как просроченные (SLA). */
  async slaCandidates(createdBefore: Date, limit = 200): Promise<string[]> {
    const rows = await this.db()
      .selectFrom(T)
      .select('id')
      .where('status', '=', 'new')
      .where('first_response_at', 'is', null)
      .where('sla_breached_at', 'is', null)
      .where('deleted_at', 'is', null)
      .where('created_at', '<=', createdBefore)
      .orderBy('created_at')
      .limit(limit)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Заявки для статистики SLA: создание, первый ответ, статус. */
  async slaRows(filter: RequestFilter & { createdFrom: Date; createdTo: Date }) {
    return this.filtered(filter)
      .select(['status', 'created_at', 'first_response_at', 'manager_id'])
      .where('created_at', '>=', filter.createdFrom)
      .where('created_at', '<', filter.createdTo)
      .execute();
  }

  /** Обезличивание контактов гостя (закон РК о ПД): снимки в заявках. */
  async anonymizeCustomer(customerId: string): Promise<string[]> {
    const rows = await this.db()
      .updateTable(T)
      .set({ contact_name: 'Гость (обезличен)', contact_phone: '', contact_email: null, wishes: null })
      .where('customer_id', '=', customerId)
      .returning('id')
      .execute();
    return rows.map((r) => r.id);
  }
}
