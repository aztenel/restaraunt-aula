import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { Translatable } from '../../../shared/kernel/translatable';
import { ReportPeriod } from '../domain/period';
import { OrderChannelCode, OrderTypeCode } from '../domain/revenue';
import { ReportingTables } from './reporting.tables';
import { branchFilter, inPeriod, whenNewer } from './sql-helpers';

const T = 'reporting.orders';

export interface OrderIdentity {
  orderId: string;
  number: string;
  branchId: string;
  type: OrderTypeCode;
  channel: OrderChannelCode;
}

export interface StatusStamp {
  status: string;
  at: Date;
  rank: number;
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
}

export interface OrderItemFact {
  dishId: string;
  name: Translatable;
  quantity: number;
  unitPrice: Money;
  lineTotal: Money;
}

export interface OrderForRefund {
  orderId: string;
  type: OrderTypeCode;
  channel: OrderChannelCode;
  branchId: string;
  completedAt: Date | null;
}

export interface CancelledOrderRow {
  orderId: string;
  number: string;
  branchId: string;
  type: string;
  channel: string;
  total: Money;
  reasonCode: string;
  reason: string | null;
  wasPaid: boolean;
  placedAt: Date | null;
  cancelledAt: Date;
}

export interface CompletedOrderRow {
  orderId: string;
  branchId: string;
  completedDate: string;
  paymentMethod: 'online' | 'on_receipt' | null;
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
}

function totalsRow(t: OrderTotals) {
  return {
    subtotal_amount: t.subtotal.amount,
    subtotal_currency: t.subtotal.currency,
    discount_amount: t.discount.amount,
    discount_currency: t.discount.currency,
    delivery_fee_amount: t.deliveryFee.amount,
    delivery_fee_currency: t.deliveryFee.currency,
    total_amount: t.total.amount,
    total_currency: t.total.currency,
  };
}

/** Проекция заказов (события Ordering) и запросы отчётов по ней. */
@Injectable()
export class OrderFactsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReportingTables>();
  }

  private base(o: OrderIdentity, s: StatusStamp) {
    return {
      order_id: o.orderId,
      number: o.number,
      branch_id: o.branchId,
      type: o.type,
      channel: o.channel,
      status: s.status,
      status_at: s.at,
      status_rank: s.rank,
    };
  }

  /** Общая часть обновления: статус — только если событие новее. */
  private statusSet() {
    return {
      number: sql<string>`excluded.number`,
      branch_id: sql<string>`excluded.branch_id`,
      type: sql<string>`excluded.type`,
      channel: sql<string>`excluded.channel`,
      status: whenNewer(T, 'status') as never,
      status_rank: whenNewer(T, 'status_rank') as never,
      status_at: whenNewer(T, 'status_at') as never,
    };
  }

  /** Итоги заказа меняются, пока заказ не выполнен; итоги OrderCompleted — окончательные. */
  private totalsSet(final: boolean) {
    const keep = (column: string) =>
      final
        ? sql.ref(`excluded.${column}`)
        : sql`case when ${sql.ref(`${T}.completed_at`)} is null then ${sql.ref(`excluded.${column}`)} else ${sql.ref(`${T}.${column}`)} end`;
    return Object.fromEntries(
      ['subtotal_amount', 'discount_amount', 'delivery_fee_amount', 'total_amount'].map((c) => [c, keep(c)]),
    ) as Record<string, never>;
  }

  async applyPlaced(
    o: OrderIdentity,
    s: StatusStamp,
    t: OrderTotals,
    placed: {
      customerId: string | null;
      paymentMethod: 'online' | 'on_receipt';
      promoCode: string | null;
      analyticsSessionId: string | null;
      placedAt: Date;
      placedDate: string;
    },
  ): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        ...this.base(o, s),
        ...totalsRow(t),
        customer_id: placed.customerId,
        payment_method: placed.paymentMethod,
        promo_code: placed.promoCode,
        analytics_session_id: placed.analyticsSessionId,
        placed_at: placed.placedAt,
        placed_date: placed.placedDate,
      })
      .onConflict((oc) =>
        oc.column('order_id').doUpdateSet({
          ...this.statusSet(),
          ...this.totalsSet(false),
          customer_id: sql<string>`excluded.customer_id`,
          payment_method: sql<string>`excluded.payment_method`,
          promo_code: sql<string>`excluded.promo_code`,
          analytics_session_id: sql<string>`excluded.analytics_session_id`,
          placed_at: sql<Date>`excluded.placed_at`,
          placed_date: sql<string>`excluded.placed_date`,
        }),
      )
      .execute();
  }

  async applyStatus(o: OrderIdentity, s: StatusStamp, total: Money, refundedAt: Date | null): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({ ...this.base(o, s), total_amount: total.amount, total_currency: total.currency, refunded_at: refundedAt })
      .onConflict((oc) =>
        oc.column('order_id').doUpdateSet({
          ...this.statusSet(),
          total_amount: sql`case when ${sql.ref(`${T}.completed_at`)} is null then excluded.total_amount else ${sql.ref(`${T}.total_amount`)} end` as never,
          refunded_at: sql`coalesce(${sql.ref(`${T}.refunded_at`)}, excluded.refunded_at)` as never,
        }),
      )
      .execute();
  }

  /** Выполнение: окончательные итоги и позиции (для топа блюд и выгрузки в учёт). */
  async applyCompleted(
    o: OrderIdentity,
    s: StatusStamp,
    t: OrderTotals,
    completed: { placedAt: Date; placedDate: string; completedAt: Date; completedDate: string; customerId: string | null },
    items: readonly OrderItemFact[],
  ): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        ...this.base(o, s),
        ...totalsRow(t),
        customer_id: completed.customerId,
        placed_at: completed.placedAt,
        placed_date: completed.placedDate,
        completed_at: completed.completedAt,
        completed_date: completed.completedDate,
      })
      .onConflict((oc) =>
        oc.column('order_id').doUpdateSet({
          ...this.statusSet(),
          ...this.totalsSet(true),
          placed_at: sql`coalesce(${sql.ref(`${T}.placed_at`)}, excluded.placed_at)` as never,
          placed_date: sql`coalesce(${sql.ref(`${T}.placed_date`)}, excluded.placed_date)` as never,
          customer_id: sql`coalesce(excluded.customer_id, ${sql.ref(`${T}.customer_id`)})` as never,
          completed_at: sql<Date>`excluded.completed_at`,
          completed_date: sql<string>`excluded.completed_date`,
        }),
      )
      .execute();
    if (items.length === 0) return;
    await this.db()
      .insertInto('reporting.order_items')
      .values(
        items.map((item, idx) => ({
          order_id: o.orderId,
          line_no: idx + 1,
          dish_id: item.dishId,
          name: JSON.stringify(item.name),
          quantity: item.quantity,
          unit_price_amount: item.unitPrice.amount,
          unit_price_currency: item.unitPrice.currency,
          line_total_amount: item.lineTotal.amount,
          line_total_currency: item.lineTotal.currency,
        })),
      )
      .onConflict((oc) =>
        oc.columns(['order_id', 'line_no']).doUpdateSet({
          dish_id: sql<string>`excluded.dish_id`,
          name: sql`excluded.name`,
          quantity: sql<number>`excluded.quantity`,
          unit_price_amount: sql<number>`excluded.unit_price_amount`,
          line_total_amount: sql<number>`excluded.line_total_amount`,
        }),
      )
      .execute();
  }

  async applyCancelled(
    o: OrderIdentity,
    s: StatusStamp,
    total: Money,
    cancel: { reasonCode: string; reason: string | null; wasPaid: boolean; cancelledAt: Date; cancelledDate: string },
  ): Promise<void> {
    await this.db()
      .insertInto(T)
      .values({
        ...this.base(o, s),
        total_amount: total.amount,
        total_currency: total.currency,
        cancel_reason_code: cancel.reasonCode,
        cancel_reason: cancel.reason,
        was_paid: cancel.wasPaid,
        cancelled_at: cancel.cancelledAt,
        cancelled_date: cancel.cancelledDate,
      })
      .onConflict((oc) =>
        oc.column('order_id').doUpdateSet({
          ...this.statusSet(),
          cancel_reason_code: sql<string>`excluded.cancel_reason_code`,
          cancel_reason: sql<string>`excluded.cancel_reason`,
          was_paid: sql<boolean>`excluded.was_paid`,
          cancelled_at: sql<Date>`excluded.cancelled_at`,
          cancelled_date: sql<string>`excluded.cancelled_date`,
        }),
      )
      .execute();
  }

  async findForRefund(orderId: string): Promise<OrderForRefund | null> {
    const row = await this.db()
      .selectFrom(T)
      .select(['order_id', 'type', 'channel', 'branch_id', 'completed_at'])
      .where('order_id', '=', orderId)
      .executeTakeFirst();
    return row
      ? {
          orderId: row.order_id,
          type: row.type as OrderTypeCode,
          channel: row.channel as OrderChannelCode,
          branchId: row.branch_id,
          completedAt: row.completed_at,
        }
      : null;
  }

  async statusOf(orderId: string): Promise<string | null> {
    const row = await this.db().selectFrom(T).select('status').where('order_id', '=', orderId).executeTakeFirst();
    return row?.status ?? null;
  }

  // ---------------------------------------------------------------- отчёты

  /** Оформлено / выполнено (и сумма) / отменено за период. */
  async counts(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ placed: number; completed: number; completed_total: number; cancelled: number; web_placed: number }>`
      select
        count(*) filter (where ${inPeriod('placed_date', period)}) as placed,
        count(*) filter (where ${inPeriod('placed_date', period)} and channel = 'web') as web_placed,
        count(*) filter (where ${inPeriod('completed_date', period)}) as completed,
        coalesce(sum(total_amount) filter (where ${inPeriod('completed_date', period)}), 0)::bigint as completed_total,
        count(*) filter (where ${inPeriod('cancelled_date', period)}) as cancelled
      from reporting.orders
      where ${branchFilter('branch_id', branchIds)}
        and (${inPeriod('placed_date', period)} or ${inPeriod('completed_date', period)} or ${inPeriod('cancelled_date', period)})
    `.execute(this.db());
    const r = result.rows[0]!;
    return {
      placed: Number(r.placed),
      webPlaced: Number(r.web_placed),
      completed: Number(r.completed),
      completedTotal: Money.of(Number(r.completed_total)),
      cancelled: Number(r.cancelled),
    };
  }

  /** Топ блюд по выполненным заказам. */
  async topDishes(period: ReportPeriod, branchIds: readonly string[] | null, sort: 'revenue' | 'quantity', limit: number) {
    const order = sort === 'quantity' ? sql`quantity desc, revenue desc` : sql`revenue desc, quantity desc`;
    const result = await sql<{ dish_id: string; name: Translatable; quantity: number; revenue: number; orders: number }>`
      select i.dish_id,
             (array_agg(i.name order by o.completed_at desc))[1] as name,
             sum(i.quantity)::bigint as quantity,
             sum(i.line_total_amount)::bigint as revenue,
             count(distinct o.order_id) as orders
      from reporting.order_items i
      join reporting.orders o on o.order_id = i.order_id
      where o.completed_at is not null and ${inPeriod('o.completed_date', period)} and ${branchFilter('o.branch_id', branchIds)}
      group by i.dish_id
      order by ${order}, i.dish_id
      limit ${limit}
    `.execute(this.db());
    return result.rows.map((r) => ({
      dishId: r.dish_id,
      name: r.name,
      quantity: Number(r.quantity),
      revenue: Money.of(Number(r.revenue)),
      orders: Number(r.orders),
    }));
  }

  async dishTotals(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ quantity: number; revenue: number }>`
      select coalesce(sum(i.quantity), 0)::bigint as quantity, coalesce(sum(i.line_total_amount), 0)::bigint as revenue
      from reporting.order_items i
      join reporting.orders o on o.order_id = i.order_id
      where o.completed_at is not null and ${inPeriod('o.completed_date', period)} and ${branchFilter('o.branch_id', branchIds)}
    `.execute(this.db());
    const r = result.rows[0]!;
    return { quantity: Number(r.quantity), revenue: Money.of(Number(r.revenue)) };
  }

  async cancelledByReason(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ reason_code: string; count: number; paid_count: number; total: number }>`
      select coalesce(cancel_reason_code, 'other') as reason_code,
             count(*) as count,
             count(*) filter (where was_paid) as paid_count,
             coalesce(sum(total_amount), 0)::bigint as total
      from reporting.orders
      where cancelled_at is not null and ${inPeriod('cancelled_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by 1
      order by count desc, reason_code
    `.execute(this.db());
    return result.rows.map((r) => ({
      reasonCode: r.reason_code,
      count: Number(r.count),
      paidCount: Number(r.paid_count),
      total: Money.of(Number(r.total)),
    }));
  }

  async cancelledPage(period: ReportPeriod, branchIds: readonly string[] | null, page: PageRequest) {
    const where = sql`cancelled_at is not null and ${inPeriod('cancelled_date', period)} and ${branchFilter('branch_id', branchIds)}`;
    const total = await sql<{ n: number }>`select count(*) as n from reporting.orders where ${where}`.execute(this.db());
    const rows = await sql<{
      order_id: string;
      number: string;
      branch_id: string;
      type: string;
      channel: string;
      total_amount: number;
      cancel_reason_code: string | null;
      cancel_reason: string | null;
      was_paid: boolean | null;
      placed_at: Date | null;
      cancelled_at: Date;
    }>`
      select order_id, number, branch_id, type, channel, total_amount, cancel_reason_code, cancel_reason, was_paid, placed_at, cancelled_at
      from reporting.orders
      where ${where}
      order by cancelled_at desc, order_id
      limit ${page.perPage} offset ${offsetOf(page)}
    `.execute(this.db());
    return {
      total: Number(total.rows[0]?.n ?? 0),
      items: rows.rows.map(
        (r): CancelledOrderRow => ({
          orderId: r.order_id,
          number: r.number,
          branchId: r.branch_id,
          type: r.type,
          channel: r.channel,
          total: Money.of(Number(r.total_amount)),
          reasonCode: r.cancel_reason_code ?? 'other',
          reason: r.cancel_reason,
          wasPaid: r.was_paid ?? false,
          placedAt: r.placed_at,
          cancelledAt: r.cancelled_at,
        }),
      ),
    };
  }

  /** Сессии витрины, из которых оформлен заказ (по дням оформления). */
  async orderedSessionsByDay(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ date: string; sessions: number }>`
      select placed_date as date, count(distinct analytics_session_id) as sessions
      from reporting.orders
      where analytics_session_id is not null and ${inPeriod('placed_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by placed_date
    `.execute(this.db());
    return result.rows.map((r) => ({ date: r.date, sessions: Number(r.sessions) }));
  }

  async orderedSessions(period: ReportPeriod, branchIds: readonly string[] | null): Promise<number> {
    const result = await sql<{ n: number }>`
      select count(distinct analytics_session_id) as n
      from reporting.orders
      where analytics_session_id is not null and ${inPeriod('placed_date', period)} and ${branchFilter('branch_id', branchIds)}
    `.execute(this.db());
    return Number(result.rows[0]?.n ?? 0);
  }

  /** Выполненные заказы по месяцам и каналу (сайт / оператор) — доля своего канала. */
  async completedByMonthAndChannel(period: ReportPeriod, branchIds: readonly string[] | null) {
    const result = await sql<{ month: string; channel: string; orders: number; revenue: number }>`
      select to_char(completed_date, 'YYYY-MM') as month, channel, count(*) as orders, coalesce(sum(total_amount), 0)::bigint as revenue
      from reporting.orders
      where completed_at is not null and ${inPeriod('completed_date', period)} and ${branchFilter('branch_id', branchIds)}
      group by 1, 2
    `.execute(this.db());
    return result.rows.map((r) => ({ month: r.month, channel: r.channel, orders: Number(r.orders), revenue: Money.of(Number(r.revenue)) }));
  }

  async completedForExport(period: ReportPeriod, branchIds: readonly string[] | null): Promise<CompletedOrderRow[]> {
    const rows = await this.db()
      .selectFrom(T)
      .select([
        'order_id',
        'branch_id',
        'completed_date',
        'payment_method',
        'subtotal_amount',
        'discount_amount',
        'delivery_fee_amount',
        'total_amount',
      ])
      .where('completed_at', 'is not', null)
      .where(inPeriod('completed_date', period))
      .where(branchFilter('branch_id', branchIds))
      .orderBy('completed_at')
      .execute();
    return rows.map((r) => ({
      orderId: r.order_id,
      branchId: r.branch_id,
      completedDate: r.completed_date!,
      paymentMethod: r.payment_method as CompletedOrderRow['paymentMethod'],
      subtotal: Money.of(r.subtotal_amount),
      discount: Money.of(r.discount_amount),
      deliveryFee: Money.of(r.delivery_fee_amount),
      total: Money.of(r.total_amount),
    }));
  }

  async itemsOf(orderIds: readonly string[]) {
    if (orderIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('reporting.order_items')
      .select(['order_id', 'dish_id', 'name', 'quantity', 'line_total_amount'])
      .where('order_id', 'in', [...orderIds])
      .orderBy('order_id')
      .orderBy('line_no')
      .execute();
    return rows.map((r) => ({
      orderId: r.order_id,
      dishId: r.dish_id,
      name: r.name as Translatable,
      quantity: r.quantity,
      lineTotal: Money.of(r.line_total_amount),
    }));
  }
}

