import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { BanquetFunnelRow } from '../domain/banquet-funnel';
import { ReportPeriod } from '../domain/period';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod, whenNewer } from './sql-helpers';

const T = 'reporting.banquet_requests';

export interface BanquetIdentity {
  requestId: string;
  number: string;
  branchId: string | null;
  isOffsite: boolean;
  eventDate: string | null;
  guests: number | null;
  managerId: string;
}

export interface BanquetStatusStamp {
  status: string;
  at: Date;
  rank: number;
}

export interface BanquetForRefund {
  requestId: string;
  branchId: string | null;
  heldAt: Date | null;
}

export interface BanquetDocumentRow {
  id: string;
  kind: 'invoice' | 'act';
  number: string;
  requestId: string;
  branchId: string | null;
  payerType: 'individual' | 'company' | null;
  companyName: string | null;
  companyBin: string | null;
  amount: Money;
  vatAmount: Money;
  paidTotal: Money;
  dueDate: string | null;
  issuedDate: string;
}

/** Проекция банкетных заявок, истории статусов и документов (события Banquet). */
@Injectable()
export class BanquetFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  private base(b: BanquetIdentity, s: BanquetStatusStamp) {
    return {
      request_id: b.requestId,
      number: b.number,
      branch_id: b.branchId,
      is_offsite: b.isOffsite,
      event_date: b.eventDate,
      guests: b.guests,
      manager_id: b.managerId,
      manager_at: s.at,
      status: s.status,
      status_at: s.at,
      status_rank: s.rank,
    };
  }

  /** Поля заявки и статус — из более нового события. */
  private newerSet() {
    return Object.fromEntries(
      ['status', 'status_at', 'status_rank', 'branch_id', 'is_offsite', 'event_date', 'guests'].map((c) => [c, whenNewer(T, c)]),
    ) as Record<string, never>;
  }

  async applyCreated(
    b: BanquetIdentity,
    s: BanquetStatusStamp,
    created: { eventType: string; budget: Money | null; source: string; requestedAt: Date; requestedDate: string },
  ): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        ...this.base(b, s),
        event_type: created.eventType,
        budget_amount: created.budget?.amount ?? null,
        budget_currency: created.budget?.currency ?? 'KZT',
        source: created.source,
        requested_at: created.requestedAt,
        requested_date: created.requestedDate,
      })
      .onConflict((oc) =>
        oc.column('request_id').doUpdateSet({
          ...this.newerSet(),
          number: sql<string>`excluded.number`,
          event_type: sql<string>`excluded.event_type`,
          budget_amount: sql`excluded.budget_amount` as never,
          source: sql<string>`excluded.source`,
          requested_at: sql<Date>`excluded.requested_at`,
          requested_date: sql<string>`excluded.requested_date`,
          manager_id: sql`case when ${sql.ref(`${T}.manager_at`)} > excluded.manager_at then ${sql.ref(`${T}.manager_id`)} else excluded.manager_id end` as never,
          manager_at: sql`greatest(${sql.ref(`${T}.manager_at`)}, excluded.manager_at)` as never,
        }),
      )
      .execute();
  }

  /**
   * Переход статуса: история (ключ — id события), текущий статус (если событие новее),
   * максимальная стадия воронки, первый ответ (первый переход из new), проведение и отмена.
   */
  async applyStatusChanged(
    eventId: string,
    b: BanquetIdentity,
    s: BanquetStatusStamp,
    change: { from: string; to: string; reason: string | null; stage: number; quoteTotal: Money | null; localDate: string },
  ): Promise<void> {
    const inserted = await this.db()
      .insertInto('reporting.banquet_status_changes')
      .values({
        event_id: eventId,
        request_id: b.requestId,
        from_status: change.from,
        to_status: change.to,
        reason: change.reason,
        occurred_at: s.at,
      })
      .onConflict((oc) => oc.column('event_id').doNothing())
      .returning('event_id')
      .executeTakeFirst();
    if (!inserted) return;

    const isHeld = change.to === 'held';
    const isCancelled = change.to === 'cancelled';
    await this.db()
      .insertInto(T)
      .values({
        ...this.base(b, s),
        max_stage: Math.max(0, change.stage),
        first_response_at: change.from === 'new' ? s.at : null,
        quote_total_amount: change.quoteTotal?.amount ?? null,
        held_at: isHeld ? s.at : null,
        held_date: isHeld ? change.localDate : null,
        held_total_amount: isHeld ? (change.quoteTotal?.amount ?? 0) : null,
        cancelled_at: isCancelled ? s.at : null,
        cancelled_from: isCancelled ? change.from : null,
        cancel_reason: isCancelled ? change.reason : null,
      })
      .onConflict((oc) =>
        oc.column('request_id').doUpdateSet({
          ...this.newerSet(),
          number: sql<string>`excluded.number`,
          max_stage: sql`greatest(${sql.ref(`${T}.max_stage`)}, excluded.max_stage)` as never,
          first_response_at: sql`case
            when excluded.first_response_at is null then ${sql.ref(`${T}.first_response_at`)}
            when ${sql.ref(`${T}.first_response_at`)} is null then excluded.first_response_at
            else least(${sql.ref(`${T}.first_response_at`)}, excluded.first_response_at) end` as never,
          quote_total_amount: sql`case when excluded.quote_total_amount is not null and excluded.status_at >= ${sql.ref(
            `${T}.status_at`,
          )} then excluded.quote_total_amount else coalesce(${sql.ref(`${T}.quote_total_amount`)}, excluded.quote_total_amount) end` as never,
          held_at: sql`coalesce(excluded.held_at, ${sql.ref(`${T}.held_at`)})` as never,
          held_date: sql`coalesce(excluded.held_date, ${sql.ref(`${T}.held_date`)})` as never,
          held_total_amount: sql`coalesce(excluded.held_total_amount, ${sql.ref(`${T}.held_total_amount`)})` as never,
          cancelled_at: sql`coalesce(excluded.cancelled_at, ${sql.ref(`${T}.cancelled_at`)})` as never,
          cancelled_from: sql`coalesce(excluded.cancelled_from, ${sql.ref(`${T}.cancelled_from`)})` as never,
          cancel_reason: sql`coalesce(excluded.cancel_reason, ${sql.ref(`${T}.cancel_reason`)})` as never,
          manager_id: sql`case when ${sql.ref(`${T}.manager_at`)} > excluded.manager_at then ${sql.ref(`${T}.manager_id`)} else excluded.manager_id end` as never,
          manager_at: sql`greatest(${sql.ref(`${T}.manager_at`)}, excluded.manager_at)` as never,
        }),
      )
      .execute();
  }

  async applyAssigned(requestId: string, managerId: string, at: Date): Promise<void> {
    await this.db()
      .updateTable(T)
      .set({ manager_id: managerId, manager_at: at })
      .where('request_id', '=', requestId)
      .where((eb) => eb.or([eb('manager_at', 'is', null), eb('manager_at', '<=', at)]))
      .execute();
  }

  async findForRefund(requestId: string): Promise<BanquetForRefund | null> {
    const row = await this.db()
      .selectFrom(T)
      .select(['request_id', 'branch_id', 'held_at'])
      .where('request_id', '=', requestId)
      .executeTakeFirst();
    return row ? { requestId: row.request_id, branchId: row.branch_id, heldAt: row.held_at } : null;
  }

  // ---------------------------------------------------------------- документы

  async insertDocument(doc: {
    id: string;
    kind: 'invoice' | 'act';
    number: string;
    requestId: string;
    branchId: string | null;
    payerType: 'individual' | 'company' | null;
    company: { name: string; bin: string } | null;
    amount: Money;
    vatAmount: Money;
    dueDate: string | null;
    issuedAt: Date;
    issuedDate: string;
  }): Promise<void> {
    await this.db()
      .insertInto('reporting.documents')
      .values({
        id: doc.id,
        kind: doc.kind,
        number: doc.number,
        request_id: doc.requestId,
        branch_id: doc.branchId,
        payer_type: doc.payerType,
        company_name: doc.company?.name ?? null,
        company_bin: doc.company?.bin ?? null,
        document_amount: doc.amount.amount,
        document_currency: doc.amount.currency,
        vat_amount: doc.vatAmount.amount,
        vat_currency: doc.vatAmount.currency,
        due_date: doc.dueDate,
        issued_at: doc.issuedAt,
        issued_date: doc.issuedDate,
      })
      .onConflict((oc) => oc.column('id').doNothing())
      .execute();
  }

  async applyInvoicePayment(invoiceId: string, paidTotal: Money, fullyPaid: boolean): Promise<void> {
    await this.db()
      .updateTable('reporting.documents')
      .set({
        paid_total_amount: sql`greatest(paid_total_amount, ${paidTotal.amount})` as never,
        fully_paid: sql`fully_paid or ${fullyPaid}` as never,
      })
      .where('id', '=', invoiceId)
      .where('kind', '=', 'invoice')
      .execute();
  }

  async requestOfInvoice(invoiceId: string): Promise<string | null> {
    const row = await this.db()
      .selectFrom('reporting.documents')
      .select('request_id')
      .where('id', '=', invoiceId)
      .where('kind', '=', 'invoice')
      .executeTakeFirst();
    return row?.request_id ?? null;
  }

  async invoiceIdsOf(requestId: string): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('reporting.documents')
      .select('id')
      .where('request_id', '=', requestId)
      .where('kind', '=', 'invoice')
      .execute();
    return rows.map((r) => r.id);
  }

  async documentsForExport(period: ReportPeriod, branchIds: readonly string[] | null): Promise<BanquetDocumentRow[]> {
    const rows = await this.db()
      .selectFrom('reporting.documents')
      .selectAll()
      .where(inPeriod('issued_date', period))
      .where(branchFilter('branch_id', branchIds))
      .orderBy('issued_at')
      .orderBy('number')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as 'invoice' | 'act',
      number: r.number,
      requestId: r.request_id,
      branchId: r.branch_id,
      payerType: r.payer_type as BanquetDocumentRow['payerType'],
      companyName: r.company_name,
      companyBin: r.company_bin,
      amount: Money.of(r.document_amount),
      vatAmount: Money.of(r.vat_amount),
      paidTotal: Money.of(r.paid_total_amount),
      dueDate: r.due_date,
      issuedDate: r.issued_date,
    }));
  }

  // ---------------------------------------------------------------- отчёты

  /** Заявки, созданные в периоде, — строки для воронки. */
  async funnelRows(period: ReportPeriod, branchIds: readonly string[] | null): Promise<BanquetFunnelRow[]> {
    const rows = await this.db()
      .selectFrom(T)
      .select(['status', 'max_stage', 'requested_at', 'first_response_at', 'cancelled_from', 'cancel_reason', 'held_total_amount'])
      .where('requested_at', 'is not', null)
      .where(inPeriod('requested_date', period))
      .where(branchFilter('branch_id', branchIds))
      .execute();
    return rows.map((r) => ({
      status: r.status,
      maxStage: r.max_stage,
      requestedAt: r.requested_at!,
      firstResponseAt: r.first_response_at,
      cancelledFrom: r.cancelled_from,
      cancelReason: r.cancel_reason,
      heldTotal: r.held_total_amount === null ? null : Money.of(r.held_total_amount),
    }));
  }

  /** Проведено банкетов в периоде (по дате проведения). */
  async heldCount(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ n: number; total: number }>`
      select count(*) as n, coalesce(sum(held_total_amount), 0)::bigint as total
      from reporting.banquet_requests
      where held_date is not null and ${inPeriod('held_date', period)} and ${branchFilter('branch_id', branchIds)}
    `.execute(this.db());
    return { count: Number(result.rows[0]?.n ?? 0), total: Money.of(Number(result.rows[0]?.total ?? 0)) };
  }
}
