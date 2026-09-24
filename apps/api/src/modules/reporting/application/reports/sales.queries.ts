import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { Money } from '../../../../shared/kernel/money';
import { ownChannelShare } from '../../domain/aggregator';
import { averageAmount } from '../../domain/amounts';
import { datesOf, monthsOf, ReportPeriod } from '../../domain/period';
import { addChannelAmount, ChannelAmounts, emptyChannelAmounts, SALES_CHANNELS, SalesChannel } from '../../domain/revenue';
import { AggregatorVolumeRepository } from '../../infrastructure/aggregator-volume.repository';
import { OrderFactsRepository } from '../../infrastructure/order-facts.repository';
import { SalesFactsRepository } from '../../infrastructure/sales-facts.repository';
import { ReportScope, ReportScopes } from '../report-scope';

export interface PeriodQuery {
  from?: string;
  to?: string;
  branchId?: string;
}

export interface ReportHeader {
  from: string;
  to: string;
  branchId: string | null;
}

export function header(period: ReportPeriod, scope: ReportScope): ReportHeader {
  return { from: period.from, to: period.to, branchId: scope.branchId };
}

// ---------------------------------------------------------------- Выручка по дням и каналам

export interface RevenueReportView extends ReportHeader {
  days: Array<{ date: string } & ChannelAmounts>;
  totals: ChannelAmounts;
  /** Количество продаж (заказов, банкетов, сертификатов) по каналам. */
  counts: Record<SalesChannel, number>;
  byBranch: Array<{ branchId: string | null } & ChannelAmounts>;
}

/** Выручка по дням и каналам (доставка, самовывоз, банкеты, сертификаты) с итогами. */
@Injectable()
export class RevenueReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly sales: SalesFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<RevenueReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const period = this.scopes.period(query);
    return this.build(period, scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<RevenueReportView> {
    const rows = await this.sales.byDayAndChannel(period, scope.branchIds);
    const days = new Map(datesOf(period).map((d) => [d, emptyChannelAmounts()]));
    let totals = emptyChannelAmounts();
    const counts = Object.fromEntries(SALES_CHANNELS.map((c) => [c, 0])) as Record<SalesChannel, number>;
    for (const row of rows) {
      days.set(row.date, addChannelAmount(days.get(row.date) ?? emptyChannelAmounts(), row.channel, row.sales, row.refunds));
      totals = addChannelAmount(totals, row.channel, row.sales, row.refunds);
      counts[row.channel] += row.salesCount;
    }
    const branches = new Map<string | null, ChannelAmounts>();
    for (const row of await this.sales.byBranchAndChannel(period, scope.branchIds)) {
      branches.set(row.branchId, addChannelAmount(branches.get(row.branchId) ?? emptyChannelAmounts(), row.channel, row.sales, row.refunds));
    }
    return {
      ...header(period, scope),
      days: [...days.entries()].map(([date, amounts]) => ({ date, ...amounts })),
      totals,
      counts,
      byBranch: [...branches.entries()]
        .map(([branchId, amounts]) => ({ branchId, ...amounts }))
        .sort((a, b) => b.total.amount - a.total.amount),
    };
  }
}

// ---------------------------------------------------------------- Средний чек

export interface AverageCheckRow {
  channel: SalesChannel;
  count: number;
  revenue: Money;
  average: Money;
}

export interface AverageCheckReportView extends ReportHeader {
  channels: AverageCheckRow[];
  /** Заказы (доставка + самовывоз). */
  orders: { count: number; revenue: Money; average: Money };
}

/** Средний чек по каналам: продажи (без возвратов) / количество продаж. */
@Injectable()
export class AverageCheckReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly sales: SalesFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<AverageCheckReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const period = this.scopes.period(query);
    const rows = await this.sales.byDayAndChannel(period, scope.branchIds);
    const channels: AverageCheckRow[] = SALES_CHANNELS.map((channel) => {
      const items = rows.filter((r) => r.channel === channel);
      const revenue = Money.sum(items.map((r) => r.sales));
      const count = items.reduce((a, r) => a + r.salesCount, 0);
      return { channel, count, revenue, average: averageAmount(revenue, count) };
    });
    const orderRows = channels.filter((c) => c.channel === 'delivery' || c.channel === 'pickup');
    const ordersRevenue = Money.sum(orderRows.map((r) => r.revenue));
    const ordersCount = orderRows.reduce((a, r) => a + r.count, 0);
    return {
      ...header(period, scope),
      channels,
      orders: { count: ordersCount, revenue: ordersRevenue, average: averageAmount(ordersRevenue, ordersCount) },
    };
  }
}

// ---------------------------------------------------------------- Доля своего канала

export interface OwnChannelRow {
  webOrders: number;
  adminOrders: number;
  ownOrders: number;
  ownRevenue: Money;
  /** Заказы агрегаторов (ручной ввод); null — данных за месяц нет. */
  aggregatorOrders: number | null;
  aggregatorRevenue: Money | null;
  /** Доля заказов мимо агрегаторов: own / (own + агрегаторы). */
  ownShare: number | null;
}

export interface OwnChannelReportView extends ReportHeader {
  months: Array<{ month: string } & OwnChannelRow>;
  totals: OwnChannelRow;
}

/**
 * Доля своего канала (цель ТЗ «доля заказов мимо агрегаторов»): выполненные заказы с сайта
 * и от оператора против помесячных итогов агрегаторов, введённых вручную.
 */
@Injectable()
export class OwnChannelReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly orders: OrderFactsRepository,
    private readonly aggregators: AggregatorVolumeRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<OwnChannelReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const period = this.scopes.period(query);
    return this.build(period, scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<OwnChannelReportView> {
    const completed = await this.orders.completedByMonthAndChannel(period, scope.branchIds);
    const volumes = await this.aggregators.list(period, scope.branchIds);
    const months = monthsOf(period).map((month) => {
      const own = completed.filter((r) => r.month === month);
      const agg = volumes.filter((v) => v.month === month);
      return { month, ...row(own, agg) };
    });
    return { ...header(period, scope), months, totals: row(completed, volumes) };
  }
}

function row(
  own: ReadonlyArray<{ channel: string; orders: number; revenue: Money }>,
  aggregators: ReadonlyArray<{ orders: number; revenue: Money }>,
): OwnChannelRow {
  const webOrders = own.filter((r) => r.channel === 'web').reduce((a, r) => a + r.orders, 0);
  const adminOrders = own.filter((r) => r.channel === 'admin').reduce((a, r) => a + r.orders, 0);
  const aggregatorOrders = aggregators.length > 0 ? aggregators.reduce((a, v) => a + v.orders, 0) : null;
  return {
    webOrders,
    adminOrders,
    ownOrders: webOrders + adminOrders,
    ownRevenue: Money.sum(own.map((r) => r.revenue)),
    aggregatorOrders,
    aggregatorRevenue: aggregators.length > 0 ? Money.sum(aggregators.map((v) => v.revenue)) : null,
    ownShare: ownChannelShare(webOrders + adminOrders, aggregatorOrders),
  };
}
