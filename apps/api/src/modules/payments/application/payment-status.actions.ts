import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { Notifier } from '../../notifications/public';
import { GatewayPaymentStatus } from '../domain/payment-gateway';
import { ConfirmationOutcome, Payment } from '../domain/payment';
import { formatTenge } from '../domain/money-format';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { PaymentsEvents } from '../public';
import { paymentAuditState, publishPaymentEvent } from './payment-events';

async function lockPayment(repo: PaymentRepository, paymentId: string): Promise<Payment> {
  const payment = await repo.findById(paymentId, { forUpdate: true });
  if (!payment) throw new NotFoundError('payment', paymentId);
  return payment;
}

/**
 * Отмена неоплаченного платежа (контракт cancelPayment: истёк срок, заказ отменён до оплаты).
 * Идемпотентно: отменённый, отклонённый или уже оплаченный платёж не меняется. Если деньги
 * успели прийти, потребитель получит PaymentSucceeded и сам запросит возврат.
 */
@Injectable()
export class CancelPayment {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(paymentId: string, reason: string): Promise<'applied' | 'ignored'> {
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const payment = await lockPayment(this.payments, paymentId);
      const before = paymentAuditState(payment);
      const reasonText = reason?.trim() || 'cancelled';
      if (payment.cancel(reasonText, now) === 'ignored') return 'ignored';
      await this.payments.save(payment);
      await this.audit.record({
        action: 'payment.cancelled',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before,
        after: paymentAuditState(payment),
        meta: { reason: reasonText },
      });
      await publishPaymentEvent(this.events, PaymentsEvents.PaymentCancelled, payment, now, { reason: reasonText });
      return 'applied';
    });
  }
}

/** Отказ по платежу: провайдер отклонил или исчерпаны попытки инициирования. */
@Injectable()
export class FailPayment {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(paymentId: string, reason: string): Promise<'applied' | 'ignored'> {
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const payment = await lockPayment(this.payments, paymentId);
      const before = paymentAuditState(payment);
      if (payment.fail(reason, now) === 'ignored') return 'ignored';
      await this.payments.save(payment);
      await this.audit.record({
        action: 'payment.failed',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before,
        after: paymentAuditState(payment),
        meta: { reason },
      });
      await publishPaymentEvent(this.events, PaymentsEvents.PaymentFailed, payment, now, { reason });
      return 'applied';
    });
  }
}

/**
 * Отметить получение денег по оплате при получении (курьер/касса). Идемпотентно.
 * Событие PaymentSucceeded с method=on_receipt: потребители не должны менять по нему статус заказа
 * (заказ уже paid — «оплата обеспечена»), это факт поступления денег для отчётов.
 */
@Injectable()
export class MarkCollected {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(paymentId: string): Promise<'applied' | 'ignored'> {
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const payment = await lockPayment(this.payments, paymentId);
      const before = paymentAuditState(payment);
      if (payment.collect(now) === 'ignored') return 'ignored';
      await this.payments.save(payment);
      await this.audit.record({
        action: 'payment.collected',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before,
        after: paymentAuditState(payment),
      });
      await publishPaymentEvent(this.events, PaymentsEvents.PaymentSucceeded, payment, now);
      return 'applied';
    });
  }
}

export interface GatewayUpdate {
  status: GatewayPaymentStatus;
  amount: Money | null;
  reason?: string | null;
  providerData?: Record<string, unknown>;
}

/**
 * Применить статус от провайдера (вебхук, опрос статуса). Под блокировкой строки платежа:
 * параллельные вебхук и опрос не применят результат дважды. Повтор для завершённого платежа
 * ничего не меняет. Несовпадение суммы — платёж не отмечается оплаченным, персоналу — оповещение.
 */
@Injectable()
export class ApplyGatewayStatus {
  private readonly logger = new Logger(ApplyGatewayStatus.name);

  constructor(
    private readonly payments: PaymentRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(paymentId: string, update: GatewayUpdate, source: 'webhook' | 'poll'): Promise<ConfirmationOutcome> {
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const payment = await lockPayment(this.payments, paymentId);
      const before = paymentAuditState(payment);
      const previousStatus = payment.status;
      payment.mergeProviderData(update.providerData);
      let outcome: ConfirmationOutcome = 'ignored';

      if (update.status === 'succeeded') {
        outcome = payment.confirmPaid(now, update.amount);
        if (outcome === 'applied') {
          await this.payments.save(payment);
          await this.audit.record({
            action: 'payment.succeeded',
            entityType: 'payment',
            entityId: payment.id,
            branchId: payment.branchId,
            before,
            after: paymentAuditState(payment),
            meta: { source, lateCapture: previousStatus !== 'pending' },
          });
          await publishPaymentEvent(this.events, PaymentsEvents.PaymentSucceeded, payment, now, {
            previousStatus: previousStatus !== 'pending' ? previousStatus : undefined,
          });
        } else if (outcome === 'amount_mismatch') {
          await this.payments.save(payment);
          await this.payments.markAmountMismatch(payment.id, now);
          await this.reportAmountMismatch(payment, update.amount!, source);
        }
      } else if (update.status === 'failed' || update.status === 'cancelled') {
        const reason = update.reason?.trim() || (update.status === 'failed' ? 'declined by provider' : 'cancelled by provider');
        const applied = update.status === 'failed' ? payment.fail(reason, now) : payment.cancel(reason, now);
        if (applied === 'applied') {
          outcome = 'applied';
          await this.payments.save(payment);
          await this.audit.record({
            action: update.status === 'failed' ? 'payment.failed' : 'payment.cancelled',
            entityType: 'payment',
            entityId: payment.id,
            branchId: payment.branchId,
            before,
            after: paymentAuditState(payment),
            meta: { source, reason },
          });
          await publishPaymentEvent(
            this.events,
            update.status === 'failed' ? PaymentsEvents.PaymentFailed : PaymentsEvents.PaymentCancelled,
            payment,
            now,
            { reason },
          );
        }
      }
      if (outcome === 'ignored' && update.providerData && Object.keys(update.providerData).length > 0) {
        await this.payments.save(payment);
      }
      return outcome;
    });
  }

  private async reportAmountMismatch(payment: Payment, reported: Money, source: string): Promise<void> {
    this.logger.warn({ paymentId: payment.id, expected: payment.amount.toJSON(), reported: reported.toJSON() }, 'Payment amount mismatch');
    await this.audit.record({
      action: 'payment.amount_mismatch',
      entityType: 'payment',
      entityId: payment.id,
      branchId: payment.branchId,
      after: { expected: payment.amount.toJSON(), reported: reported.toJSON(), source },
    });
    await this.notifier.notifyStaff({
      audience: { branchId: payment.branchId, permission: Permission.PaymentsRefund },
      template: 'staff.system_alert',
      params: {
        title: 'Сумма оплаты не совпадает',
        details:
          `Платёж ${payment.id} (${payment.purpose} ${payment.referenceId}): ожидалось ${formatTenge(payment.amount)}, ` +
          `провайдер ${payment.provider} сообщил ${formatTenge(reported)}. Платёж не отмечен оплаченным — проверьте вручную.`,
      },
      dedupeKey: `payment:${payment.id}:amount_mismatch`,
      related: { type: 'payment', id: payment.id },
    });
  }
}
