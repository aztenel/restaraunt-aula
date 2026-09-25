import { Injectable } from '@nestjs/common';
import { AdminFeed } from '../../notifications/public';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { PaymentsService } from '../../payments/public';
import { Order } from '../domain/order';
import { PromoUsageStatus } from '../domain/promo-code';
import { OrderRefundRecord } from '../infrastructure/order-payments.repository';
import { PromoCodeRepository } from '../infrastructure/promo-code.repository';
import { ScheduleCourierCancellation } from './courier-requests';
import { RequestOrderRefunds } from './request-order-refunds';

export interface SettleCancelledOrderInput {
  actor: Actor;
  /** Сумма возврата оплаченного заказа (частичный возврат); null — всё оплаченное. */
  refundAmount: Money | null;
  reason: string;
}

/**
 * Деньги и ресурсы отменённого заказа (в транзакции отмены), docs/decisions.md:
 * - неоплаченные платежи (онлайн-ссылка, оплата при получении) отменяются;
 * - промокод освобождается, если заказ отменён до оплаты;
 * - полученные деньги возвращаются (по умолчанию полностью), списание с сертификата — на сертификат;
 * - активная заявка на курьера отменяется задачей.
 * Когда все запрошенные возвраты пройдут — заказ перейдёт в refunded (обработчик RefundSucceeded).
 */
@Injectable()
export class SettleCancelledOrder {
  constructor(
    private readonly payments: PaymentsService,
    private readonly promos: PromoCodeRepository,
    private readonly refunds: RequestOrderRefunds,
    private readonly courier: ScheduleCourierCancellation,
    private readonly feed: AdminFeed,
  ) {}

  async execute(order: Order, input: SettleCancelledOrderInput): Promise<OrderRefundRecord[]> {
    const s = order.snapshot();
    for (const p of await this.payments.listForReference('order', order.id)) {
      if (p.status === 'created' || p.status === 'pending') await this.payments.cancelPayment(p.id, input.reason);
    }
    if (!s.wasPaid) {
      await this.promos.setUsageStatus(order.id, PromoUsageStatus.Reserved, PromoUsageStatus.Released);
    }
    const refunds = await this.refunds.execute({
      order,
      amount: s.wasPaid ? input.refundAmount : null,
      kind: 'cancellation',
      reason: input.reason,
      actor: input.actor,
    });
    if (await this.courier.execute(order.id, order.branchId)) {
      await this.feed.push({
        branchId: order.branchId,
        stream: 'orders',
        kind: 'updated',
        entityId: order.id,
        title: `Заказ ${s.number} отменён: заявка на курьера отменяется`,
        sound: false,
      });
    }
    return refunds;
  }
}
