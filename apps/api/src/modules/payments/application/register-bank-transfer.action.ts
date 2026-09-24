import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { isEnumValue } from '../../../shared/kernel/state-machine';
import { Payment } from '../domain/payment';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { PaymentPurpose, PaymentsEvents, PaymentView } from '../public';
import { paymentAuditState, publishPaymentEvent } from './payment-events';

export interface RegisterBankTransferInput {
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  amount: Money;
  paidAt: Date;
  documentNumber: string;
  idempotencyKey: string;
}

/**
 * Поступление по банковскому переводу (счёт юрлицу): регистрирует финансист по выписке.
 * Платёж сразу succeeded, событие PaymentSucceeded. Идемпотентно по ключу.
 */
@Injectable()
export class RegisterBankTransfer {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterBankTransferInput): Promise<PaymentView> {
    if (!isEnumValue(PaymentPurpose, input.purpose)) {
      throw new ValidationError('payment.purpose_invalid', 'Unknown payment purpose');
    }
    const existing = await this.payments.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.same(existing, input);
    return this.database.transaction(async () => {
      const now = this.clock.now();
      if (input.paidAt.getTime() > now.getTime() + 60_000) {
        throw new ValidationError('payment.paid_at_in_future', 'Payment date cannot be in the future');
      }
      const payment = Payment.create(
        {
          id: newId(),
          purpose: input.purpose,
          referenceId: input.referenceId,
          branchId: input.branchId,
          method: 'bank_transfer',
          provider: 'bank_transfer',
          amount: input.amount,
          description: `Платёжное поручение № ${input.documentNumber}`,
          customer: { phone: null, name: null, email: null },
          returnUrl: null,
          idempotencyKey: input.idempotencyKey,
          documentNumber: input.documentNumber,
          paidAt: input.paidAt,
        },
        now,
      );
      if (!(await this.payments.insert(payment))) {
        const raced = await this.payments.findByIdempotencyKey(input.idempotencyKey);
        if (raced) return this.same(raced, input);
        throw new ConflictError('payment.idempotency_conflict', 'Payment with this idempotency key is being created');
      }
      await this.audit.record({
        action: 'payment.bank_transfer_registered',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        after: paymentAuditState(payment),
        meta: { purpose: input.purpose, referenceId: input.referenceId, documentNumber: input.documentNumber },
      });
      await publishPaymentEvent(this.events, PaymentsEvents.PaymentSucceeded, payment, now);
      return (await this.payments.findById(payment.id))!.toView();
    });
  }

  private same(existing: Payment, input: RegisterBankTransferInput): PaymentView {
    if (existing.purpose !== input.purpose || existing.referenceId !== input.referenceId || existing.method !== 'bank_transfer') {
      throw new ConflictError('payment.idempotency_key_reused', 'Idempotency key was used for another payment', {
        paymentId: existing.id,
      });
    }
    return existing.toView();
  }
}
