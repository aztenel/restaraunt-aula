import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { Money } from '../../../shared/kernel/money';
import { AdminFeed } from '../../notifications/public';
import { PaymentEventPayload, PaymentPurpose, RefundEventPayload } from '../../payments/public';
import { formatMoney } from '../domain/order-texts';
import { confirmedAmount, isFullyPaid, refundsSettled } from '../domain/payment-plan';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderPaymentState } from './order-payment-state';
import { OrderTransitionRecorder } from './order-transition-recorder';
import { RequestOrderRefunds } from './request-order-refunds';

const PAYMENTS_ACTOR = () => Actor.system('payments');

/**
 * Успешный платёж по заказу (событие PaymentSucceeded; выполняется в транзакции обработчика):
 * - заказ ждёт оплаты и оплачено не меньше итога (онлайн + сертификат) — awaiting_payment → paid;
 * - заказ уже отменён (или возвращён) — «поздняя оплата»: платёж возвращается полностью;
 * - заказ уже оплачен другим платежом — лишний онлайн-платёж возвращается полностью.
 * Оплата при получении (markCollected) статус заказа не меняет — это факт получения денег.
 */
@Injectable()
export class ApplyOrderPayment {
  private readonly logger = new Logger(ApplyOrderPayment.name);

  constructor(
    private readonly orders: OrderRepository,
    private readonly state: OrderPaymentState,
    private readonly recorder: OrderTransitionRecorder,
    private readonly refunds: RequestOrderRefunds,
    private readonly feed: AdminFeed,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(payment: PaymentEventPayload): Promise<void> {
    if (payment.purpose !== PaymentPurpose.Order || payment.method === 'on_receipt') return;
    const order = await this.orders.findById(payment.referenceId, { forUpdate: true });
    if (!order) {
      this.logger.warn({ paymentId: payment.paymentId, orderId: payment.referenceId }, 'Payment for unknown order');
      return;
    }
    const actor = PAYMENTS_ACTOR();
    const s = order.snapshot();
    if (order.status === 'awaiting_payment') {
      const { positions } = await this.state.load(order.id);
      if (!isFullyPaid(positions, order.total)) return;
      const before = order.auditView();
      order.markPaid(this.clock.now());
      await this.orders.save(order);
      await this.recorder.record(order, { actor, before, notifyGuestPaid: true });
      return;
    }
    if (order.status === 'cancelled' || order.status === 'refunded') {
      // Поздняя оплата: заказ отменён (например, не оплачен вовремя), деньги возвращаются полностью.
      const requested = await this.refunds.execute({
        order,
        amount: null,
        kind: 'late_payment',
        paymentId: payment.paymentId,
        reason: `Оплата заказа ${s.number} поступила после отмены`,
        actor,
      });
      if (requested.length > 0) {
        await this.audit.record({
          action: 'order.late_payment',
          entityType: 'order',
          entityId: order.id,
          branchId: order.branchId,
          after: { paymentId: payment.paymentId, amount: payment.amount, status: order.status },
          actor,
        });
        await this.feed.push({
          branchId: order.branchId,
          stream: 'orders',
          kind: 'updated',
          entityId: order.id,
          title: `Заказ ${s.number}: оплата после отмены, запрошен возврат ${formatMoney(Money.fromJson(payment.amount))}`,
          sound: false,
        });
      }
      return;
    }
    if (order.status === 'draft' || payment.method !== 'online') return;
    // Заказ уже оплачен: лишний онлайн-платёж (например, гость оплатил старую ссылку) возвращается.
    const { positions } = await this.state.load(order.id);
    const others = positions.filter((p) => p.paymentId !== payment.paymentId);
    if (confirmedAmount(others).greaterThanOrEqual(order.total)) {
      await this.refunds.execute({
        order,
        amount: null,
        kind: 'duplicate_payment',
        paymentId: payment.paymentId,
        reason: `Повторная оплата заказа ${s.number}`,
        actor,
      });
    }
  }
}

/**
 * Результат возврата по заказу (RefundSucceeded / RefundFailed): статус возврата в заказе; когда все
 * запрошенные возвраты отменённого заказа прошли — cancelled → refunded и уведомление гостю.
 * Неудача — оповещение в ленту админки (финансист повторяет возврат в разделе платежей).
 */
@Injectable()
export class ApplyOrderRefundResult {
  constructor(
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly recorder: OrderTransitionRecorder,
    private readonly feed: AdminFeed,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(refund: RefundEventPayload, outcome: 'succeeded' | 'failed'): Promise<void> {
    if (refund.purpose !== PaymentPurpose.Order) return;
    const order = await this.orders.findById(refund.referenceId, { forUpdate: true });
    if (!order) return;
    const actor = PAYMENTS_ACTOR();
    const now = this.clock.now();
    const existing = await this.orderPayments.findRefund(refund.refundId);
    if (existing) {
      if (existing.status === outcome) return;
      await this.orderPayments.setRefundStatus(refund.refundId, outcome, now);
    } else {
      // Возврат запрошен вне заказа (раздел платежей админки) — учитываем его в заказе.
      await this.orderPayments.addRefund({
        refundId: refund.refundId,
        orderId: order.id,
        paymentId: refund.paymentId,
        kind: 'external',
        status: outcome,
        amount: Money.fromJson(refund.amount),
        reason: refund.reason,
        requestedBy: null,
      });
      await this.orderPayments.setRefundStatus(refund.refundId, outcome, now);
    }
    const s = order.snapshot();
    await this.audit.record({
      action: outcome === 'succeeded' ? 'order.refund_succeeded' : 'order.refund_failed',
      entityType: 'order',
      entityId: order.id,
      branchId: order.branchId,
      before: { refundId: refund.refundId, status: existing?.status ?? null },
      after: { refundId: refund.refundId, status: outcome, amount: refund.amount, paymentId: refund.paymentId },
      actor,
    });
    if (outcome === 'failed') {
      await this.feed.push({
        branchId: order.branchId,
        stream: 'orders',
        kind: 'updated',
        entityId: order.id,
        title: `Заказ ${s.number}: возврат ${formatMoney(Money.fromJson(refund.amount))} не прошёл`,
        sound: true,
      });
      return;
    }
    if (order.status !== 'cancelled') return;
    const refunds = await this.orderPayments.refundsForOrder(order.id);
    if (!refundsSettled(refunds)) return;
    const before = order.auditView();
    order.markRefunded(now);
    await this.orders.save(order);
    await this.recorder.record(order, { actor, before });
  }
}
