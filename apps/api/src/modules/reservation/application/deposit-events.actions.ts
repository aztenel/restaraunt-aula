import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { PaymentEventPayload, PaymentsService, RefundEventPayload } from '../../payments/public';
import { decideOnDepositPayment } from '../domain/deposit-policy';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationAccess } from './reservation-access';
import { ReservationRecorder } from './reservation-recorder';

const SYSTEM = Actor.system('reservation.deposit');

/**
 * Оплата депозита (PaymentSucceeded, purpose reservation_deposit): бронь, ждущая депозит, становится
 * confirmed (или pending, если место требует ручного подтверждения). Если бронь уже снята / отменена
 * или депозит уже оплачен другим платежом — деньги возвращаются полностью. Повтор того же платежа
 * ничего не меняет. Выполняется в транзакции обработчика события.
 */
@Injectable()
export class ApplyDepositPayment {
  private readonly logger = new Logger(ApplyDepositPayment.name);

  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly payments: PaymentsService,
    private readonly recorder: ReservationRecorder,
    private readonly audit: AuditLog,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(payment: PaymentEventPayload): Promise<void> {
    if (payment.purpose !== 'reservation_deposit') return;
    await this.database.transaction(async () => {
      const r = await this.reservations.findById(payment.referenceId, { forUpdate: true });
      if (!r) {
        this.logger.warn({ paymentId: payment.paymentId, referenceId: payment.referenceId }, 'Deposit payment for unknown reservation');
        return;
      }
      const before = r.auditState();
      const currentAttempt = r.depositPaymentId;
      const decision = decideOnDepositPayment({
        status: r.status,
        depositState: r.depositState,
        depositPaidPaymentId: r.depositPaidPaymentId,
        paymentId: payment.paymentId,
      });
      if (decision === 'already_applied') return;
      if (decision === 'apply') {
        const change = r.applyDepositPayment(payment.paymentId, this.clock.now());
        await this.reservations.update(r);
        // Оплачена прежняя попытка, а гость уже начал новую — новую отменяем.
        if (currentAttempt && currentAttempt !== payment.paymentId) {
          await this.payments.cancelPayment(currentAttempt, 'reservation_deposit_paid_by_other_payment');
        }
        await this.audit.record({
          action: 'reservation.deposit_paid',
          entityType: 'reservation',
          entityId: r.id,
          branchId: r.branchId,
          before: { depositState: before.depositState, status: before.status },
          after: { depositState: r.depositState, status: r.status, amount: payment.amount },
          meta: { number: r.number, paymentId: payment.paymentId, provider: payment.provider },
          actor: SYSTEM,
        });
        const ctx = await this.access.context(r);
        await this.recorder.transitioned(r, change, null, { ...ctx, actor: SYSTEM, before });
        return;
      }
      // Поздняя или повторная оплата — полный возврат этого платежа (депозит брони не меняется).
      await this.payments.requestRefund({
        paymentId: payment.paymentId,
        reason: decision === 'refund_duplicate' ? `Повторная оплата депозита брони ${r.number}` : `Бронь ${r.number} уже не ждёт оплату`,
        idempotencyKey: `reservation:${r.id}:refund:${payment.paymentId}`,
      });
      await this.audit.record({
        action: 'reservation.deposit_payment_refunded',
        entityType: 'reservation',
        entityId: r.id,
        branchId: r.branchId,
        before: { status: r.status, depositState: r.depositState },
        after: { status: r.status, depositState: r.depositState },
        meta: { number: r.number, paymentId: payment.paymentId, amount: payment.amount, decision },
        actor: SYSTEM,
      });
    });
  }
}

/** Результат возврата депозита (RefundSucceeded / RefundFailed по платежу, которым депозит оплачен). */
@Injectable()
export class RecordDepositRefund {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly audit: AuditLog,
    private readonly database: Database,
  ) {}

  async execute(refund: RefundEventPayload, succeeded: boolean): Promise<void> {
    if (refund.purpose !== 'reservation_deposit') return;
    await this.database.transaction(async () => {
      const r = await this.reservations.findById(refund.referenceId, { forUpdate: true });
      if (!r || r.depositPaidPaymentId !== refund.paymentId) return;
      const before = r.depositState;
      if (!r.markDepositRefund(succeeded)) return;
      await this.reservations.update(r);
      await this.audit.record({
        action: succeeded ? 'reservation.deposit_refunded' : 'reservation.deposit_refund_failed',
        entityType: 'reservation',
        entityId: r.id,
        branchId: r.branchId,
        before: { depositState: before },
        after: { depositState: r.depositState },
        meta: { number: r.number, refundId: refund.refundId, paymentId: refund.paymentId, amount: refund.amount },
        actor: SYSTEM,
      });
    });
  }
}
