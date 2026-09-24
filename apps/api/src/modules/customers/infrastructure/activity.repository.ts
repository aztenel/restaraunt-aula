import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { ActivityDraft, ActivityType, ActivityTypeStat } from '../domain/history';
import { CustomersTables } from './customers.tables';

export interface ActivityRecord {
  id: string;
  customerId: string;
  type: ActivityType;
  entityType: string;
  entityId: string;
  branchId: string | null;
  amount: Money | null;
  countsAsSpent: boolean;
  summary: string;
  meta: Record<string, unknown>;
  occurredAt: Date;
}

export interface Period {
  from: Date | null;
  to: Date | null;
}

/** История гостя (только добавление). */
@Injectable()
export class ActivityRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  /**
   * Вставка строки истории. Повтор того же события (source_event_id) ничего не вставляет —
   * вторая защита идемпотентности поверх платформенной. Возвращает true, если строка добавлена.
   */
  async insert(input: { id: string; customerId: string; draft: ActivityDraft; sourceEventId: string | null }): Promise<boolean> {
    const d = input.draft;
    const row = await this.db()
      .insertInto('customers.activities')
      .values({
        id: input.id,
        customer_id: input.customerId,
        type: d.type,
        entity_type: d.entityType,
        entity_id: d.entityId,
        branch_id: d.branchId,
        money_amount: d.amount?.amount ?? null,
        money_currency: d.amount?.currency ?? 'KZT',
        counts_as_spent: d.countsAsSpent,
        summary: d.summary,
        meta: JSON.stringify(d.meta),
        occurred_at: d.occurredAt,
        source_event_id: input.sourceEventId,
      })
      .onConflict((oc) => oc.columns(['source_event_id', 'type']).where('source_event_id', 'is not', null).doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  /** Гость, у которого есть строка истории данного типа по объекту (например, «заказ выполнен»). */
  async customerForEntity(entityType: string, entityId: string, type: ActivityType): Promise<string | null> {
    const row = await this.db()
      .selectFrom('customers.activities')
      .select('customer_id')
      .where('entity_type', '=', entityType)
      .where('entity_id', '=', entityId)
      .where('type', '=', type)
      .orderBy('occurred_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.customer_id ?? null;
  }

  private scoped(customerId: string, period: Period) {
    let q = this.db().selectFrom('customers.activities').where('customer_id', '=', customerId);
    if (period.from) q = q.where('occurred_at', '>=', period.from);
    if (period.to) q = q.where('occurred_at', '<', period.to);
    return q;
  }

  async listForCustomer(customerId: string, period: Period, page: PageRequest): Promise<Page<ActivityRecord>> {
    const q = this.scoped(customerId, period);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q
      .selectAll()
      .orderBy('occurred_at', 'desc')
      .orderBy('id', 'desc')
      .limit(page.perPage)
      .offset(offsetOf(page))
      .execute();
    return pageOf(
      rows.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        type: r.type as ActivityType,
        entityType: r.entity_type,
        entityId: r.entity_id,
        branchId: r.branch_id,
        amount: r.money_amount === null ? null : Money.of(Number(r.money_amount), r.money_currency.trim() as Currency),
        countsAsSpent: r.counts_as_spent,
        summary: r.summary,
        meta: (r.meta ?? {}) as Record<string, unknown>,
        occurredAt: r.occurred_at,
      })),
      Number(total?.n ?? 0),
      page,
    );
  }

  /** Итоги за период по типам: число строк и сумма покупок (строки с counts_as_spent). */
  async statsForCustomer(customerId: string, period: Period): Promise<ActivityTypeStat[]> {
    const rows = await this.scoped(customerId, period)
      .select([
        'type',
        (eb) => eb.fn.countAll<number>().as('count'),
        sql<number>`coalesce(sum(money_amount) filter (where counts_as_spent), 0)::bigint`.as('spent'),
      ])
      .groupBy('type')
      .execute();
    return rows.map((r) => ({ type: r.type as ActivityType, count: Number(r.count), spentAmount: Number(r.spent) }));
  }
}
