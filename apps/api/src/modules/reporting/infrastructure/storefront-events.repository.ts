import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { ReportPeriod } from '../domain/period';
import { StorefrontEvent } from '../domain/storefront';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod } from './sql-helpers';

export interface StorefrontSessionStats {
  sessions: number;
  menuView: number;
  dishView: number;
  addToCart: number;
  checkoutStart: number;
}

/** Сырые события витрины (без персональных данных) и агрегаты для конверсии. */
@Injectable()
export class StorefrontEventsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  async insert(event: StorefrontEvent, occurredAt: Date, localDate: string): Promise<void> {
    await this.db()
      .insertInto('reporting.storefront_events')
      .values({
        id: newId(),
        session_id: event.sessionId,
        type: event.type,
        branch_id: event.branchId,
        path: event.path,
        occurred_at: occurredAt,
        local_date: localDate,
      })
      .execute();
  }

  /** Уникальные сессии витрины и сессии, дошедшие до шагов воронки. */
  async sessionStats(period: ReportPeriod, branchIds: readonly string[] | null): Promise<StorefrontSessionStats> {
    const result = await sql<{ sessions: number; menu_view: number; dish_view: number; add_to_cart: number; checkout_start: number }>`
      select count(distinct session_id) as sessions,
             count(distinct session_id) filter (where type = 'menu_view') as menu_view,
             count(distinct session_id) filter (where type = 'dish_view') as dish_view,
             count(distinct session_id) filter (where type = 'add_to_cart') as add_to_cart,
             count(distinct session_id) filter (where type = 'checkout_start') as checkout_start
      from reporting.storefront_events
      where ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
    `.execute(this.db());
    const r = result.rows[0]!;
    return {
      sessions: Number(r.sessions),
      menuView: Number(r.menu_view),
      dishView: Number(r.dish_view),
      addToCart: Number(r.add_to_cart),
      checkoutStart: Number(r.checkout_start),
    };
  }

  async sessionsByDay(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ date: string; sessions: number }>`
      select local_date as date, count(distinct session_id) as sessions
      from reporting.storefront_events
      where ${inPeriod('local_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by local_date
    `.execute(this.db());
    return result.rows.map((r) => ({ date: r.date, sessions: Number(r.sessions) }));
  }

  /** Удалить сырые события старше даты (срок хранения). Возвращает число удалённых. */
  async purgeBefore(date: string): Promise<number> {
    const result = await this.db().deleteFrom('reporting.storefront_events').where('local_date', '<', date).executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
  }
}
