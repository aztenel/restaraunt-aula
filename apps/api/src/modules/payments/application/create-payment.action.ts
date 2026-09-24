import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus, JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { isEnumValue } from '../../../shared/kernel/state-machine';
import { Payment } from '../domain/payment';
import { CertificateRecord } from '../infrastructure/certificate.repository';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { CreatePaymentCommand, PaymentMethod, PaymentPurpose, PaymentsEvents, PaymentView } from '../public';
import { DebitCertificate } from './certificates/certificate-ledger.actions';
import { FindCertificateByCode } from './certificates/find-certificate-by-code.action';
import { paymentAuditState, publishPaymentEvent } from './payment-events';
import { PaymentGatewayRegistry } from './payment-gateway.registry';

export const PaymentJobs = {
  Initiate: 'payments.initiate',
  Refund: 'payments.refund',
  CheckStatus: 'payments.check_status',
} as const;

export interface InitiateJobPayload {
  paymentId: string;
}

/**
 * Создание платежа (контракт PaymentsService.createPayment). Идемпотентно по idempotencyKey:
 * повторный вызов возвращает тот же платёж, второй платёж не создаётся.
 *
 * - online: запись в статусе created + задача payments.initiate (провайдер вызывается асинхронно);
 * - on_receipt: pending без обращения к провайдеру;
 * - gift_certificate: списание с сертификата в той же транзакции, статус succeeded, событие PaymentSucceeded;
 * - bank_transfer — только через registerBankTransfer (нужны документ и дата поступления).
 */
@Injectable()
export class CreatePayment {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly registry: PaymentGatewayRegistry,
    private readonly findCertificate: FindCertificateByCode,
    private readonly debitCertificate: DebitCertificate,
    private readonly database: Database,
    private readonly jobs: JobQueue,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(cmd: CreatePaymentCommand): Promise<PaymentView> {
    if (!isEnumValue(PaymentPurpose, cmd.purpose)) {
      throw new ValidationError('payment.purpose_invalid', 'Unknown payment purpose', { purpose: cmd.purpose });
    }
    if (!isEnumValue(PaymentMethod, cmd.method)) {
      throw new ValidationError('payment.method_invalid', 'Unknown payment method', { method: cmd.method });
    }
    if (cmd.method === 'bank_transfer') {
      throw new ValidationError('payment.bank_transfer_via_registration', 'Bank transfers are registered with registerBankTransfer');
    }
    const existing = await this.payments.findByIdempotencyKey(cmd.idempotencyKey);
    if (existing) return this.sameRequest(existing, cmd);

    return this.database.transaction(async () => {
      const now = this.clock.now();
      let provider: string = cmd.method;
      let certificate: CertificateRecord | null = null;
      if (cmd.method === 'online') {
        provider = (await this.registry.resolveForNewPayment(cmd.branchId)).provider;
      } else if (cmd.method === 'gift_certificate') {
        if (!cmd.certificateCode) throw new ValidationError('payment.certificate_code_required', 'Certificate code is required');
        certificate = await this.findCertificate.execute(cmd.certificateCode, { forUpdate: true });
        certificate.certificate.assertUsable(now);
      }

      const payment = Payment.create(
        {
          id: newId(),
          purpose: cmd.purpose,
          referenceId: cmd.referenceId,
          branchId: cmd.branchId,
          method: cmd.method,
          provider,
          amount: cmd.amount,
          description: cmd.description,
          customer: {
            phone: tryNormalizePhone(cmd.customer.phone) ?? (cmd.customer.phone?.trim() || null),
            name: cmd.customer.name?.trim() || null,
            email: cmd.customer.email?.trim() || null,
          },
          returnUrl: cmd.returnUrl,
          idempotencyKey: cmd.idempotencyKey,
          certificateId: certificate?.certificate.id ?? null,
          expiresAt: cmd.expiresAt ?? null,
        },
        now,
      );
      if (!(await this.payments.insert(payment))) {
        // Параллельный запрос с тем же ключом успел раньше.
        const raced = await this.payments.findByIdempotencyKey(cmd.idempotencyKey);
        if (raced) return this.sameRequest(raced, cmd);
        throw new ConflictError('payment.idempotency_conflict', 'Payment with this idempotency key is being created');
      }

      if (cmd.method === 'online') {
        await this.jobs.enqueue(PaymentJobs.Initiate, { paymentId: payment.id } satisfies InitiateJobPayload, {
          aggregateId: payment.id,
          branchId: payment.branchId,
        });
      }
      if (certificate) {
        await this.debitCertificate.execute({
          record: certificate,
          amount: cmd.amount,
          channel: 'order',
          branchId: cmd.branchId,
          paymentId: payment.id,
          referenceType: cmd.purpose,
          referenceId: cmd.referenceId,
          comment: cmd.description,
        });
      }
      await this.audit.record({
        action: 'payment.created',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        after: paymentAuditState(payment),
        meta: { purpose: cmd.purpose, referenceId: cmd.referenceId },
      });
      if (payment.status === 'succeeded') {
        await publishPaymentEvent(this.events, PaymentsEvents.PaymentSucceeded, payment, now);
      }
      return (await this.payments.findById(payment.id))!.toView();
    });
  }

  private sameRequest(existing: Payment, cmd: CreatePaymentCommand): PaymentView {
    if (existing.purpose !== cmd.purpose || existing.referenceId !== cmd.referenceId || existing.method !== cmd.method) {
      throw new ConflictError('payment.idempotency_key_reused', 'Idempotency key was used for another payment', {
        paymentId: existing.id,
      });
    }
    return existing.toView();
  }
}
