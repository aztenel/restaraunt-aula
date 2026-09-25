import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Actor } from '../../../shared/kernel/actor';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { PaymentsService } from '../../payments/public';
import { Order } from '../domain/order';
import { allocateRefund, totalRefundable } from '../domain/payment-plan';
import { OrderPaymentsRepository, OrderRefundKind, OrderRefundRecord } from '../infrastructure/order-payments.repository';
import { OrderPaymentState } from './order-payment-state';

export interface RequestOrderRefundsInput {
  order: Order;
  /** null — вернуть весь возвратный остаток. */
  amount: Money | null;
  kind: Exclude<OrderRefundKind, 'external'>;
  reason: string;
  actor: Actor;
  /** Вернуть только этот платёж (поздняя или лишняя оплата). */
  paymentId?: string;
}

/**
 * Запрос возвратов по заказу через модуль Payments (исполнение — задачей платёжного модуля).
 * Сумма распределяется по платежам: сначала деньги, сертификат — последним (domain/payment-plan).
 * Каждый возврат записывается в заказ: когда все возвраты отменённого заказа пройдут — refunded.
 * Ключи идемпотентности детерминированы для отмены/поздней оплаты — повтор не вернёт деньги дважды.
 */
@Injectable()
export class RequestOrderRefunds {
  constructor(
    private readonly state: OrderPaymentState,
    private readonly payments: PaymentsService,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly audit: AuditLog,
  ) {}

  async execute(input: RequestOrderRefundsInput): Promise<OrderRefundRecord[]> {
    const { order } = input;
    const snapshot = await this.state.load(order.id);
    const positions = input.paymentId ? snapshot.positions.filter((p) => p.paymentId === input.paymentId) : snapshot.positions;
    const allocations = allocateRefund(input.amount, positions);
    const requested: OrderRefundRecord[] = [];
    for (const allocation of allocations) {
      const key =
        input.kind === 'partial' ? `order:${order.id}:partial:${newId()}` : `order:${order.id}:${input.kind}:${allocation.paymentId}`;
      const refund = await this.payments.requestRefund({
        paymentId: allocation.paymentId,
        amount: allocation.amount,
        reason: input.reason,
        idempotencyKey: key,
      });
      await this.orderPayments.addRefund({
        refundId: refund.id,
        orderId: order.id,
        paymentId: allocation.paymentId,
        kind: input.kind,
        status: refund.status,
        amount: refund.amount,
        reason: input.reason,
        requestedBy: input.actor.userId,
      });
      const record = await this.orderPayments.findRefund(refund.id);
      if (record) requested.push(record);
    }
    if (requested.length > 0) {
      await this.audit.record({
        action: 'order.refund_requested',
        entityType: 'order',
        entityId: order.id,
        branchId: order.branchId,
        before: { refundable: totalRefundable(positions).toJSON() },
        after: {
          kind: input.kind,
          amount: Money.sum(requested.map((r) => r.amount)).toJSON(),
          refunds: requested.map((r) => ({ refundId: r.refundId, paymentId: r.paymentId, amount: r.amount.toJSON() })),
        },
        meta: { number: order.snapshot().number, reason: input.reason },
        actor: input.actor,
      });
    }
    return requested;
  }
}
