import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money, MoneyJson } from '../../../shared/kernel/money';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import {
  AccountingExport,
  AccountingExportFormat,
  AccountingExportState,
  AccountingExportStatus,
  AccountingExportTotals,
  AccountingPushStatus,
} from '../domain/accounting-export';
import { AccountingExportsTable, ReportingTables } from './reporting.tables';

type TotalsJson = Record<'retailSales' | 'refunds' | 'certificateSales' | 'invoices' | 'acts', MoneyJson> &
  Record<'retailDocuments' | 'invoiceCount' | 'actCount', number>;

function totalsToJson(t: AccountingExportTotals): TotalsJson {
  return {
    retailSales: t.retailSales.toJSON(),
    refunds: t.refunds.toJSON(),
    certificateSales: t.certificateSales.toJSON(),
    invoices: t.invoices.toJSON(),
    acts: t.acts.toJSON(),
    retailDocuments: t.retailDocuments,
    invoiceCount: t.invoiceCount,
    actCount: t.actCount,
  };
}

function totalsFromJson(j: TotalsJson | null): AccountingExportTotals | null {
  if (!j) return null;
  return {
    retailSales: Money.fromJson(j.retailSales),
    refunds: Money.fromJson(j.refunds),
    certificateSales: Money.fromJson(j.certificateSales),
    invoices: Money.fromJson(j.invoices),
    acts: Money.fromJson(j.acts),
    retailDocuments: j.retailDocuments,
    invoiceCount: j.invoiceCount,
    actCount: j.actCount,
  };
}

function toState(r: Selectable<AccountingExportsTable>): AccountingExportState {
  return {
    id: r.id,
    format: r.format as AccountingExportFormat,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    branchId: r.branch_id,
    status: r.status as AccountingExportStatus,
    buildAttempts: r.build_attempts,
    file:
      r.file_key && r.file_name && r.content_type
        ? { key: r.file_key, name: r.file_name, contentType: r.content_type, sizeBytes: r.size_bytes ?? 0 }
        : null,
    totals: totalsFromJson(r.totals as TotalsJson | null),
    error: r.error,
    pushRequested: r.push_requested,
    pushStatus: r.push_status as AccountingPushStatus,
    pushAttempts: r.push_attempts,
    pushedAt: r.pushed_at,
    pushError: r.push_error,
    requestedBy: r.requested_by,
    requestedAt: r.requested_at,
    completedAt: r.completed_at,
  };
}

function toRow(s: AccountingExportState) {
  return {
    format: s.format,
    period_from: s.periodFrom,
    period_to: s.periodTo,
    branch_id: s.branchId,
    status: s.status,
    file_key: s.file?.key ?? null,
    file_name: s.file?.name ?? null,
    content_type: s.file?.contentType ?? null,
    size_bytes: s.file?.sizeBytes ?? null,
    totals: s.totals ? JSON.stringify(totalsToJson(s.totals)) : null,
    error: s.error,
    push_requested: s.pushRequested,
    push_status: s.pushStatus,
    push_attempts: s.pushAttempts,
    pushed_at: s.pushedAt,
    push_error: s.pushError,
    requested_by: s.requestedBy,
    requested_at: s.requestedAt,
    completed_at: s.completedAt,
  };
}

/** Выгрузки в учёт (1С): состояние построения файла и отправки. */
export interface AccountingExportListFilter {
  branchId?: string;
  /** YYYY-MM-DD (включительно). */
  from?: string;
  to?: string;
}

@Injectable()
export class AccountingExportRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  async insert(e: AccountingExport): Promise<void> {
    const s = e.snapshot();
    await this.db()
      .insertInto('reporting.accounting_exports')
      .values({ id: s.id, build_attempts: s.buildAttempts, ...toRow(s) })
      .execute();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<AccountingExport | null> {
    let q = this.db().selectFrom('reporting.accounting_exports').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? AccountingExport.restore(toState(row)) : null;
  }

  /** Сохранить состояние (счётчики попыток меняются только increment*). */
  async save(e: AccountingExport): Promise<void> {
    const s = e.snapshot();
    await this.db().updateTable('reporting.accounting_exports').set(toRow(s)).where('id', '=', s.id).execute();
  }

  async incrementBuildAttempts(id: string): Promise<number> {
    const row = await this.db()
      .updateTable('reporting.accounting_exports')
      .set({ build_attempts: sql`build_attempts + 1` as never })
      .where('id', '=', id)
      .returning('build_attempts')
      .executeTakeFirst();
    return row?.build_attempts ?? 0;
  }

  async incrementPushAttempts(id: string): Promise<number> {
    const row = await this.db()
      .updateTable('reporting.accounting_exports')
      .set({ push_attempts: sql`push_attempts + 1` as never })
      .where('id', '=', id)
      .returning('push_attempts')
      .executeTakeFirst();
    return row?.push_attempts ?? 0;
  }

  /**
   * branchIds: 'all' — все выгрузки; иначе — по этим филиалам (без сводных).
   * filter.branchId — только выгрузки филиала; filter.from/to — период выгрузки пересекается с заданным.
   */
  async list(branchIds: 'all' | readonly string[], page: PageRequest, filter: AccountingExportListFilter = {}) {
    let q = this.db().selectFrom('reporting.accounting_exports');
    if (branchIds !== 'all') q = branchIds.length === 0 ? q.where(sql<boolean>`false`) : q.where('branch_id', 'in', [...branchIds]);
    if (filter.branchId) q = q.where('branch_id', '=', filter.branchId);
    if (filter.from) q = q.where('period_to', '>=', filter.from);
    if (filter.to) q = q.where('period_from', '<=', filter.to);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('requested_at', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return { total: Number(total?.n ?? 0), items: rows.map((r) => AccountingExport.restore(toState(r))) };
  }
}
