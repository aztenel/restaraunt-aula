import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { Money } from '../../../shared/kernel/money';
import {
  OrderCancelledPayload,
  OrderCompletedPayload,
  OrderingEvents,
  OrderPlacedPayload,
  OrderStatusChangedPayload,
} from '../../ordering/public';
import { RecognizeRefundRevenue } from '../application/recognize-refund-revenue.action';
import { localDateOf } from '../domain/period';
import { ORDER_STATUS_RANK, orderSale } from '../domain/revenue';
import { OrderFactsRepository, OrderIdentity, StatusStamp } from '../infrastructure/order-facts.repository';
import { PaymentFactsRepository } from '../infrastructure/payment-facts.repository';
import { SalesFactsRepository } from '../infrastructure/sales-facts.repository';

function identity(p: { orderId: string; number: string; branchId: string; type: 'delivery' | 'pickup'; channel: 'web' | 'admin' }): OrderIdentity {
  return { orderId: p.orderId, number: p.number, branchId: p.branchId, type: p.type, channel: p.channel };
}

function stamp(status: string, at: Date): StatusStamp {
  return { status, at, rank: ORDER_STATUS_RANK[status] ?? 0 };
}

/**
 * Проекция заказов из событий Ordering. Идемпотентно (upsert по orderId), устойчиво
 * к событиям не по порядку. Выручка — при OrderCompleted (docs/decisions.md «Отчётность»).
 */
@Injectable()
export class ReportingOrderingProjection {
  constructor(
    private readonly orders: OrderFactsRepository,
    private readonly sales: SalesFactsRepository,
    private readonly payments: PaymentFactsRepository,
    private readonly recognizeRefund: RecognizeRefundRevenue,
  ) {}

  @OnEvent(OrderingEvents.OrderPlaced)
  async onPlaced(e: EventEnvelope<OrderPlacedPayload>): Promise<void> {
    const p = e.payload;
    const placedAt = new Date(p.occurredAt);
    await this.orders.applyPlaced(
      identity(p),
      stamp(p.status, placedAt),
      {
        subtotal: Money.fromJson(p.subtotal),
        discount: Money.fromJson(p.discount),
        deliveryFee: Money.fromJson(p.deliveryFee),
        total: Money.fromJson(p.total),
      },
      {
        customerId: p.customer.customerId,
        paymentMethod: p.paymentMethod,
        promoCode: p.promoCode,
        analyticsSessionId: p.analyticsSessionId,
        placedAt,
        placedDate: localDateOf(placedAt),
      },
    );
  }

  @OnEvent(OrderingEvents.OrderStatusChanged)
  async onStatusChanged(e: EventEnvelope<OrderStatusChangedPayload>): Promise<void> {
    const p = e.payload;
    const at = new Date(p.occurredAt);
    await this.orders.applyStatus(identity(p), stamp(p.to, at), Money.fromJson(p.total), p.to === 'refunded' ? at : null);
  }

  @OnEvent(OrderingEvents.OrderCompleted)
  async onCompleted(e: EventEnvelope<OrderCompletedPayload>): Promise<void> {
    const p = e.payload;
    const completedAt = new Date(p.completedAt);
    const placedAt = new Date(p.placedAt);
    const total = Money.fromJson(p.total);
    await this.orders.applyCompleted(
      identity(p),
      stamp('completed', completedAt),
      { subtotal: Money.fromJson(p.subtotal), discount: Money.fromJson(p.discount), deliveryFee: Money.fromJson(p.deliveryFee), total },
      {
        placedAt,
        placedDate: localDateOf(placedAt),
        completedAt,
        completedDate: localDateOf(completedAt),
        customerId: p.customer.customerId,
      },
      p.items.map((item) => ({
        dishId: item.dishId,
        name: item.name,
        quantity: item.quantity,
        unitPrice: Money.fromJson(item.unitPrice),
        lineTotal: Money.fromJson(item.lineTotal),
      })),
    );
    await this.sales.insert(orderSale({ orderId: p.orderId, type: p.type, channel: p.channel, branchId: p.branchId, total, completedAt }));
    // Возвраты, пришедшие раньше события о выполнении (частичный возврат по выполненному заказу).
    for (const refund of await this.payments.refundsFor('order', [p.orderId])) {
      await this.recognizeRefund.execute(refund.refundId);
    }
  }

  @OnEvent(OrderingEvents.OrderCancelled)
  async onCancelled(e: EventEnvelope<OrderCancelledPayload>): Promise<void> {
    const p = e.payload;
    const cancelledAt = new Date(p.cancelledAt);
    await this.orders.applyCancelled(identity(p), stamp('cancelled', cancelledAt), Money.fromJson(p.total), {
      reasonCode: p.reasonCode,
      reason: p.reason,
      wasPaid: p.wasPaid,
      cancelledAt,
      cancelledDate: localDateOf(cancelledAt),
    });
  }
}
