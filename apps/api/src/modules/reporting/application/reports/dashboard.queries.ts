import { Injectable } from '@nestjs/common';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { Money } from '../../../../shared/kernel/money';
import { addDays } from '../../../../shared/kernel/time';
import { averageAmount, ratio } from '../../domain/amounts';
import { computeBanquetFunnel } from '../../domain/banquet-funnel';
import { dailyScope } from '../../domain/daily-report';
import { findOverbookings } from '../../domain/hall-load';
import { datesOf, localDateOf, ReportPeriod } from '../../domain/period';
import { BanquetFactsRepository } from '../../infrastructure/banquet-facts.repository';
import { DailyReportRepository } from '../../infrastructure/daily-report.repository';
import { OrderFactsRepository } from '../../infrastructure/order-facts.repository';
import { ReservationFactsRepository } from '../../infrastructure/reservation-facts.repository';
import { SalesFactsRepository } from '../../infrastructure/sales-facts.repository';
import { StorefrontEventsRepository } from '../../infrastructure/storefront-events.repository';
import { ReportScope, ReportScopes } from '../report-scope';
import { header, OwnChannelReport, PeriodQuery, ReportHeader } from './sales.queries';

export interface PeriodKpis {
  from: string;
  to: string;
  /** Выручка нетто (продажи − возвраты признанной выручки) по всем каналам. */
  revenue: Money;
  completedOrders: number;
  /** Средний чек заказов (доставка + самовывоз). */
  averageCheck: Money;
  placedOrders: number;
  cancelledOrders: number;
  /** Новые брони гостей (по дате оформления). */
  reservations: number;
  guests: number;
  banquetRequests: number;
  banquetAnsweredWithinSlaShare: number | null;
  sessions: number;
  conversion: number | null;
}

/** Ключевые показатели за период (панель, дневной отчёт). */
@Injectable()
export class KpiCalculator {
  constructor(
    private readonly sales: SalesFactsRepository,
    private readonly orders: OrderFactsRepository,
    private readonly reservations: ReservationFactsRepository,
    private readonly banquets: BanquetFactsRepository,
    private readonly storefront: StorefrontEventsRepository,
    private readonly clock: Clock,
  ) {}

  async compute(period: ReportPeriod, scope: ReportScope): Promise<PeriodKpis> {
    const salesRows = await this.sales.byDayAndChannel(period, scope.branchIds);
    const revenue = Money.sum(salesRows.map((r) => r.sales.add(r.refunds)));
    const orderSales = salesRows.filter((r) => r.channel === 'delivery' || r.channel === 'pickup');
    const orderRevenue = Money.sum(orderSales.map((r) => r.sales));
    const orderCount = orderSales.reduce((a, r) => a + r.salesCount, 0);
    const counts = await this.orders.counts(period, scope.branchIds);
    const reservations = await this.reservations.counts(period, scope.branchIds);
    const funnel = computeBanquetFunnel(await this.banquets.funnelRows(period, scope.branchIds), this.clock.now());
    const stats = await this.storefront.sessionStats(period, scope.branchIds);
    const ordered = await this.orders.orderedSessions(period, scope.branchIds);
    return {
      from: period.from,
      to: period.to,
      revenue,
      completedOrders: counts.completed,
      averageCheck: averageAmount(orderRevenue, orderCount),
      placedOrders: counts.placed,
      cancelledOrders: counts.cancelled,
      reservations: reservations.created,
      guests: reservations.guests,
      banquetRequests: funnel.total,
      banquetAnsweredWithinSlaShare: funnel.answeredWithinSlaShare,
      sessions: stats.sessions,
      conversion: ratio(ordered, stats.sessions),
    };
  }
}

export interface DashboardView {
  branchId: string | null;
  generatedAt: Date;
  today: PeriodKpis;
  yesterday: PeriodKpis;
  last7Days: PeriodKpis;
}

/** Панель показателей: сегодня, вчера, последние 7 дней (включая сегодня). */
@Injectable()
export class DashboardReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly kpis: KpiCalculator,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, query: { branchId?: string }): Promise<DashboardView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const now = this.clock.now();
    const today = localDateOf(now);
    const yesterday = addDays(today, -1);
    return {
      branchId: scope.branchId,
      generatedAt: now,
      today: await this.kpis.compute({ from: today, to: today }, scope),
      yesterday: await this.kpis.compute({ from: yesterday, to: yesterday }, scope),
      last7Days: await this.kpis.compute({ from: addDays(today, -6), to: today }, scope),
    };
  }
}

// ---------------------------------------------------------------- Цели ТЗ

export interface GoalsReportView extends ReportHeader {
  /** Доля заказов мимо агрегаторов (null — нет данных агрегаторов за период). */
  ownChannelShare: number | null;
  ownOrders: number;
  aggregatorOrders: number | null;
  /** Доля банкетных заявок с ответом за 30 минут (цель 95%). */
  banquetAnsweredWithinSlaShare: number | null;
  banquetRequests: number;
  /** Потерянные заявки (цель 0). */
  lostBanquetRequests: number;
  /** Накладки по залам (цель 0). */
  overbookings: number;
  /** Дневные отчёты: сколько завершённых дней в периоде и за сколько отчёт сформирован автоматически. */
  dailyReportsExpected: number;
  dailyReportsGenerated: number;
}

/** Измеримые цели ТЗ за период: свой канал, ответ на банкет за 30 минут, потери, накладки, дневной отчёт. */
@Injectable()
export class GoalsReport {
  constructor(
    private readonly scopes: ReportScopes,
    private readonly ownChannel: OwnChannelReport,
    private readonly banquets: BanquetFactsRepository,
    private readonly reservations: ReservationFactsRepository,
    private readonly dailyReports: DailyReportRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, query: PeriodQuery): Promise<GoalsReportView> {
    const scope = await this.scopes.resolve(actor, query.branchId);
    const period = this.scopes.period(query);
    const own = await this.ownChannel.build(period, scope);
    const funnel = computeBanquetFunnel(await this.banquets.funnelRows(period, scope.branchIds), this.clock.now());
    const overbookings = findOverbookings(await this.reservations.occupying(period, scope.branchIds)).length;
    const today = localDateOf(this.clock.now());
    const completedDays = datesOf(period).filter((d) => d < today);
    const generated =
      completedDays.length > 0
        ? await this.dailyReports.countGenerated({ from: completedDays[0]!, to: completedDays[completedDays.length - 1]! }, dailyScope(scope.branchId))
        : 0;
    return {
      ...header(period, scope),
      ownChannelShare: own.totals.ownShare,
      ownOrders: own.totals.ownOrders,
      aggregatorOrders: own.totals.aggregatorOrders,
      banquetAnsweredWithinSlaShare: funnel.answeredWithinSlaShare,
      banquetRequests: funnel.total,
      lostBanquetRequests: funnel.lost,
      overbookings,
      dailyReportsExpected: completedDays.length,
      dailyReportsGenerated: generated,
    };
  }
}
