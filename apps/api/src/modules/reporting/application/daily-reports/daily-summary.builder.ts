import { Injectable } from '@nestjs/common';
import { Clock } from '../../../../shared/kernel/clock';
import { Money } from '../../../../shared/kernel/money';
import { averageAmount, ratio } from '../../domain/amounts';
import { computeBanquetFunnel } from '../../domain/banquet-funnel';
import { DailySummary } from '../../domain/daily-report';
import { addChannelAmount, emptyChannelAmounts } from '../../domain/revenue';
import { BanquetFactsRepository } from '../../infrastructure/banquet-facts.repository';
import { OrderFactsRepository } from '../../infrastructure/order-facts.repository';
import { PaymentFactsRepository } from '../../infrastructure/payment-facts.repository';
import { ReservationFactsRepository } from '../../infrastructure/reservation-facts.repository';
import { SalesFactsRepository } from '../../infrastructure/sales-facts.repository';
import { StorefrontEventsRepository } from '../../infrastructure/storefront-events.repository';
import { ReportScope } from '../report-scope';

/** Сводка за локальный день по филиалу или по сети (для дневного отчёта). */
@Injectable()
export class DailySummaryBuilder {
  constructor(
    private readonly sales: SalesFactsRepository,
    private readonly orders: OrderFactsRepository,
    private readonly reservations: ReservationFactsRepository,
    private readonly banquets: BanquetFactsRepository,
    private readonly payments: PaymentFactsRepository,
    private readonly storefront: StorefrontEventsRepository,
    private readonly clock: Clock,
  ) {}

  async build(date: string, scope: ReportScope): Promise<DailySummary> {
    const period = { from: date, to: date };
    const branchIds = scope.branchIds;
    let revenue = emptyChannelAmounts();
    let orderRevenue = Money.zero();
    let orderSalesCount = 0;
    for (const row of await this.sales.byDayAndChannel(period, branchIds)) {
      revenue = addChannelAmount(revenue, row.channel, row.sales, row.refunds);
      if (row.channel === 'delivery' || row.channel === 'pickup') {
        orderRevenue = orderRevenue.add(row.sales);
        orderSalesCount += row.salesCount;
      }
    }
    const counts = await this.orders.counts(period, branchIds);
    const reservations = await this.reservations.counts(period, branchIds);
    const funnel = computeBanquetFunnel(await this.banquets.funnelRows(period, branchIds), this.clock.now());
    const held = await this.banquets.heldCount(period, branchIds);
    const cash = await this.payments.byDay(period, branchIds);
    const stats = await this.storefront.sessionStats(period, branchIds);
    const ordered = await this.orders.orderedSessions(period, branchIds);
    const top = await this.orders.topDishes(period, branchIds, 'revenue', 5);
    return {
      date,
      branchId: scope.branchId,
      revenue,
      orders: {
        placed: counts.placed,
        completed: counts.completed,
        cancelled: counts.cancelled,
        averageCheck: averageAmount(orderRevenue, orderSalesCount),
      },
      reservations,
      banquets: {
        newRequests: funnel.total,
        answeredWithinSla: funnel.answeredWithinSla,
        unansweredOverdue: funnel.unansweredOverdue,
        held: held.count,
        heldTotal: held.total,
      },
      payments: {
        received: Money.sum(cash.map((c) => c.received)),
        refunded: Money.sum(cash.map((c) => c.refunded)),
      },
      storefront: { sessions: stats.sessions, orderedSessions: ordered, conversion: ratio(ordered, stats.sessions) },
      topDishes: top.map((t) => ({ dishId: t.dishId, name: t.name, quantity: t.quantity, revenue: t.revenue })),
    };
  }
}
