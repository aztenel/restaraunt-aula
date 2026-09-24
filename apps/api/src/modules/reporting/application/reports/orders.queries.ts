import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { Money } from '../../../../shared/kernel/money';
import { Page, pageOf, pageRequest } from '../../../../shared/kernel/pagination';
import { Translatable } from '../../../../shared/kernel/translatable';
import { ratio } from '../../domain/amounts';
import { datesOf, ReportPeriod } from '../../domain/period';
import { CancelledOrderRow, OrderFactsRepository } from '../../infrastructure/order-facts.repository';
import { StorefrontEventsRepository } from '../../infrastructure/storefront-events.repository';
import { ReportScope, ReportScopes } from '../report-scope';
import { header, PeriodQuery, ReportHeader } from './sales.queries';

// ---------------------------------------------------------------- Конверсия витрины

export interface ConversionReportView extends ReportHeader {
  /** Уникальные сессии витрины. */
  sessions: number;
  menuViewSessions: number;
  dishViewSessions: number;
  addToCartSessions: number;
  checkoutSessions: number;
  /** Сессии, из которых оформлен заказ (OrderPlaced.analyticsSessionId). */
  orderedSessions: number;
  /** Заказы, оформленные на сайте (канал web). */
  webOrders: number;
  /** orderedSessions / sessions. */
  conversion: number | null;
  days: Array<{ date: string; sessions: number; orderedSessions: number; conversion: number | null }>;
}

/** Конверсия витрины в заказ: сессии с оформленным заказом / сессии витрины. */
@Injectable()
export class ConversionReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly storefront: StorefrontEventsRepository,
    private readonly orders: OrderFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<ConversionReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope);
  }

  async build(period: ReportPeriod, scope: ReportScope): Promise<ConversionReportView> {
    const stats = await this.storefront.sessionStats(period, scope.branchIds);
    const orderedSessions = await this.orders.orderedSessions(period, scope.branchIds);
    const counts = await this.orders.counts(period, scope.branchIds);
    const sessionsByDay = new Map((await this.storefront.sessionsByDay(period, scope.branchIds)).map((r) => [r.date, r.sessions]));
    const orderedByDay = new Map((await this.orders.orderedSessionsByDay(period, scope.branchIds)).map((r) => [r.date, r.sessions]));
    return {
      ...header(period, scope),
      sessions: stats.sessions,
      menuViewSessions: stats.menuView,
      dishViewSessions: stats.dishView,
      addToCartSessions: stats.addToCart,
      checkoutSessions: stats.checkoutStart,
      orderedSessions,
      webOrders: counts.webPlaced,
      conversion: ratio(orderedSessions, stats.sessions),
      days: datesOf(period).map((date) => {
        const sessions = sessionsByDay.get(date) ?? 0;
        const ordered = orderedByDay.get(date) ?? 0;
        return { date, sessions, orderedSessions: ordered, conversion: ratio(ordered, sessions) };
      }),
    };
  }
}

// ---------------------------------------------------------------- Топ блюд

export const TOP_DISHES_SORTS = ['revenue', 'quantity'] as const;
export type TopDishesSort = (typeof TOP_DISHES_SORTS)[number];

export interface TopDishView {
  rank: number;
  dishId: string;
  name: Translatable;
  quantity: number;
  orders: number;
  revenue: Money;
  revenueShare: number | null;
}

export interface TopDishesReportView extends ReportHeader {
  sort: TopDishesSort;
  items: TopDishView[];
  totalQuantity: number;
  totalRevenue: Money;
}

/** Топ блюд по выполненным заказам: количество и выручка по позициям. */
@Injectable()
export class TopDishesReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly orders: OrderFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery & { sort?: TopDishesSort; limit?: number }): Promise<TopDishesReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope, query.sort ?? 'revenue', query.limit ?? 20);
  }

  async build(period: ReportPeriod, scope: ReportScope, sort: TopDishesSort, limit: number): Promise<TopDishesReportView> {
    const rows = await this.orders.topDishes(period, scope.branchIds, sort, Math.min(Math.max(limit, 1), 200));
    const totals = await this.orders.dishTotals(period, scope.branchIds);
    return {
      ...header(period, scope),
      sort,
      items: rows.map((r, idx) => ({ rank: idx + 1, ...r, revenueShare: ratio(r.revenue.amount, totals.revenue.amount) })),
      totalQuantity: totals.quantity,
      totalRevenue: totals.revenue,
    };
  }
}

// ---------------------------------------------------------------- Отменённые заказы и причины

export interface CancelledOrdersReportView extends ReportHeader {
  placed: number;
  cancelled: number;
  /** cancelled / placed за период. */
  cancelledShare: number | null;
  cancelledTotal: Money;
  reasons: Array<{ reasonCode: string; count: number; paidCount: number; total: Money }>;
  orders: Page<CancelledOrderRow>;
}

/** Отменённые заказы: причины (код, количество, сумма, сколько было оплачено) и список. */
@Injectable()
export class CancelledOrdersReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly orders: OrderFactsRepository,
  ) {}

  async execute(actor: Actor, query: PeriodQuery & { page?: number; perPage?: number }): Promise<CancelledOrdersReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    return this.build(this.scopes.period(query), scope, query.page, query.perPage);
  }

  async build(period: ReportPeriod, scope: ReportScope, page?: number, perPage?: number): Promise<CancelledOrdersReportView> {
    const req = pageRequest(page, perPage);
    const reasons = await this.orders.cancelledByReason(period, scope.branchIds);
    const counts = await this.orders.counts(period, scope.branchIds);
    const list = await this.orders.cancelledPage(period, scope.branchIds, req);
    return {
      ...header(period, scope),
      placed: counts.placed,
      cancelled: counts.cancelled,
      cancelledShare: ratio(counts.cancelled, counts.placed),
      cancelledTotal: Money.sum(reasons.map((r) => r.total)),
      reasons,
      orders: pageOf(list.items, list.total, req),
    };
  }
}
