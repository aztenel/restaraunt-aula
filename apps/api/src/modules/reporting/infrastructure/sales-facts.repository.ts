import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { ReportPeriod } from '../domain/period';
import { SalesChannel, SalesFact } from '../domain/revenue';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod } from './sql-helpers';

export interface SalesDayChannelRow {
  date: string;
  channel: SalesChannel;
  sales: Money;
  refunds: Money;
  salesCount: number;
}

/** Факты выручки (продажи и возвраты признанной выручки). Одна строка на источник. */
@Injectable()
export class SalesFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  /** Идемпотентно: повтор того же источника не создаёт вторую строку. true — строка добавлена. */
  async insert(fact: SalesFact): Promise<boolean> {
    const inserted = await this.db()
      .insertInto('reporting.sales_facts')
      .values({
        id: newId(),
        source_type: fact.sourceType,
        source_id: fact.sourceId,
        kind: fact.kind,
        channel: fact.channel,
        branch_id: fact.branchId,
        order_channel: fact.orderChannel,
        reference_id: fact.referenceId,
        occurred_at: fact.occurredAt,
        local_date: fact.localDate,
        revenue_amount: fact.amount.amount,
        revenue_currency: fact.amount.currency,
      })
      .onConflict((oc) => oc.columns(['source_type', 'source_id']).doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!inserted;
  }

  /** Пересчёт суммы строки продажи (часть заказа, оплаченная сертификатом, пришла после признания). */
  async setSaleAmount(sourceType: SalesFact['sourceType'], sourceId: string, amount: Money): Promise<void> {
    await this.db()
      .updateTable('reporting.sales_facts')
      .set({ revenue_amount: amount.amount })
      .where('source_type', '=', sourceType)
      .where('source_id', '=', sourceId)
      .where('kind', '=', 'sale')
      .execute();
  }

  async byDayAndChannel(period: ReportPeriod, branchIds: readonly string[] | null): Promise<SalesDayChannelRow[]> {
    const result = await sql<{ date: string; channel: SalesChannel; sales: number; refunds: number; sales_count: number }>`
      select local_date as date, channel,
             coalesce(sum(revenue_amount) filter (where kind = 'sale'), 0)::bigint as sales,
             coalesce(sum(revenue_amount) filter (where kind = 'refund'), 0)::bigint as refunds,
             count(*) filter (where kind = 'sale') as sales_count
      from reporting.sales_facts
      where ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by local_date, channel
      order by local_date, channel
    `.execute(this.db());
    return result.rows.map((r) => ({
      date: r.date,
      channel: r.channel,
      sales: Money.of(Number(r.sales)),
      refunds: Money.of(Number(r.refunds)),
      salesCount: Number(r.sales_count),
    }));
  }

  async byBranchAndChannel(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ branch_id: string | null; channel: SalesChannel; sales: number; refunds: number }>`
      select branch_id, channel,
             coalesce(sum(revenue_amount) filter (where kind = 'sale'), 0)::bigint as sales,
             coalesce(sum(revenue_amount) filter (where kind = 'refund'), 0)::bigint as refunds
      from reporting.sales_facts
      where ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by branch_id, channel
    `.execute(this.db());
    return result.rows.map((r) => ({
      branchId: r.branch_id,
      channel: r.channel,
      sales: Money.of(Number(r.sales)),
      refunds: Money.of(Number(r.refunds)),
    }));
  }

  /** Возвраты по заказам (доставка, самовывоз) по дням и филиалам — для выгрузки в учёт. */
  async orderRefundsByDay(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ branch_id: string; date: string; amount: number }>`
      select branch_id, local_date as date, (-sum(revenue_amount))::bigint as amount
      from reporting.sales_facts
      where kind = 'refund' and channel in ('delivery', 'pickup') and branch_id is not null
        and ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by branch_id, local_date
    `.execute(this.db());
    return result.rows.map((r) => ({ branchId: r.branch_id, date: r.date, amount: Money.of(Number(r.amount)) }));
  }

  /** Продажи сертификатов по дням (нетто с возвратами) — для выгрузки в учёт. */
  async certificateSalesByDay(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ branch_id: string | null; date: string; count: number; amount: number }>`
      select branch_id, local_date as date, count(*) filter (where kind = 'sale') as count, sum(revenue_amount)::bigint as amount
      from reporting.sales_facts
      where channel = 'certificate' and ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by branch_id, local_date
      order by local_date
    `.execute(this.db());
    return result.rows.map((r) => ({ branchId: r.branch_id, date: r.date, count: Number(r.count), amount: Money.of(Number(r.amount)) }));
  }
}
