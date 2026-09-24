import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { ReportPeriod } from '../domain/period';
import { ReportingTables } from './reporting.tables';
import { inPeriod } from './sql-helpers';

/** Сохранённый дневной отчёт; summary — JSON сводки (деньги как { amount, currency }). */
export interface DailyReportRecord {
  id: string;
  date: string;
  scope: string;
  branchId: string | null;
  summary: Record<string, unknown>;
  fileKey: string | null;
  generatedAt: Date;
  notifiedAt: Date | null;
}

@Injectable()
export class DailyReportRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  private map(r: {
    id: string;
    report_date: string;
    scope: string;
    branch_id: string | null;
    summary: unknown;
    file_key: string | null;
    generated_at: Date;
    notified_at: Date | null;
  }): DailyReportRecord {
    return {
      id: r.id,
      date: r.report_date,
      scope: r.scope,
      branchId: r.branch_id,
      summary: r.summary as Record<string, unknown>,
      fileKey: r.file_key,
      generatedAt: r.generated_at,
      notifiedAt: r.notified_at,
    };
  }

  async find(date: string, scope: string): Promise<DailyReportRecord | null> {
    const row = await this.db()
      .selectFrom('reporting.daily_reports')
      .selectAll()
      .where('report_date', '=', date)
      .where('scope', '=', scope)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  /** Повторное формирование за ту же дату перезаписывает сводку и файл (отчёт идемпотентен по дате и области). */
  async upsert(input: {
    date: string;
    scope: string;
    branchId: string | null;
    summary: unknown;
    fileKey: string;
    generatedAt: Date;
  }): Promise<DailyReportRecord> {
    const row = await this.db()
      .insertInto('reporting.daily_reports')
      .values({
        id: newId(),
        report_date: input.date,
        scope: input.scope,
        branch_id: input.branchId,
        summary: JSON.stringify(input.summary),
        file_key: input.fileKey,
        generated_at: input.generatedAt,
      })
      .onConflict((oc) =>
        oc.columns(['report_date', 'scope']).doUpdateSet({
          summary: sql`excluded.summary`,
          file_key: sql<string>`excluded.file_key`,
          generated_at: sql<Date>`excluded.generated_at`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async markNotified(id: string, at: Date): Promise<void> {
    await this.db().updateTable('reporting.daily_reports').set({ notified_at: at }).where('id', '=', id).execute();
  }

  /** Список сохранённых отчётов. scopes: null — все; иначе только эти области ('all' и/или id филиалов). */
  async list(period: ReportPeriod, scopes: readonly string[] | null, page: PageRequest) {
    let q = this.db().selectFrom('reporting.daily_reports').where(inPeriod('report_date', period));
    if (scopes !== null) q = scopes.length === 0 ? q.where(sql<boolean>`false`) : q.where('scope', 'in', [...scopes]);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll()
      .orderBy('report_date', 'desc')
      .orderBy('scope')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return { total: Number(total?.n ?? 0), items: rows.map((r) => this.map(r)) };
  }

  async countGenerated(period: ReportPeriod, scope: string): Promise<number> {
    const row = await this.db()
      .selectFrom('reporting.daily_reports')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where(inPeriod('report_date', period))
      .where('scope', '=', scope)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
