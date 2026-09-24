import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { ReportPeriod } from '../domain/period';
import { ReportingTables } from './reporting.tables';
import { branchFilter } from './sql-helpers';

export interface AggregatorVolumeRecord {
  id: string;
  branchId: string;
  month: string;
  source: string;
  sourceName: string;
  orders: number;
  revenue: Money;
  updatedBy: string | null;
  updatedAt: Date;
}

function toMonth(date: string): string {
  return date.slice(0, 7);
}

/** Ручной ввод помесячных итогов агрегаторов (для доли своего канала). */
@Injectable()
export class AggregatorVolumeRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  private map(r: {
    id: string;
    branch_id: string;
    month: string;
    source: string;
    source_name: string;
    orders_count: number;
    revenue_amount: number;
    updated_by: string | null;
    updated_at: Date;
  }): AggregatorVolumeRecord {
    return {
      id: r.id,
      branchId: r.branch_id,
      month: toMonth(r.month),
      source: r.source,
      sourceName: r.source_name,
      orders: r.orders_count,
      revenue: Money.of(r.revenue_amount),
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    };
  }

  async find(branchId: string, month: string, source: string): Promise<AggregatorVolumeRecord | null> {
    const row = await this.db()
      .selectFrom('reporting.aggregator_volumes')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('month', '=', `${month}-01`)
      .where('source', '=', source)
      .executeTakeFirst();
    return row ? this.map(row) : null;
  }

  async upsert(input: {
    branchId: string;
    month: string;
    source: string;
    sourceName: string;
    orders: number;
    revenue: Money;
    updatedBy: string | null;
  }): Promise<AggregatorVolumeRecord> {
    const row = await this.db()
      .insertInto('reporting.aggregator_volumes')
      .values({
        id: newId(),
        branch_id: input.branchId,
        month: `${input.month}-01`,
        source: input.source,
        source_name: input.sourceName,
        orders_count: input.orders,
        revenue_amount: input.revenue.amount,
        revenue_currency: input.revenue.currency,
        updated_by: input.updatedBy,
      })
      .onConflict((oc) =>
        oc.columns(['branch_id', 'month', 'source']).doUpdateSet({
          source_name: sql<string>`excluded.source_name`,
          orders_count: sql<number>`excluded.orders_count`,
          revenue_amount: sql<number>`excluded.revenue_amount`,
          updated_by: sql<string>`excluded.updated_by`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.map(row);
  }

  async list(period: ReportPeriod, branchIds: readonly string[] | null): Promise<AggregatorVolumeRecord[]> {
    const rows = await this.db()
      .selectFrom('reporting.aggregator_volumes')
      .selectAll()
      .where('month', '>=', `${toMonth(period.from)}-01`)
      .where('month', '<=', period.to)
      .where(branchFilter('branch_id', branchIds))
      .orderBy('month')
      .orderBy('branch_id')
      .orderBy('source')
      .execute();
    return rows.map((r) => this.map(r));
  }
}
