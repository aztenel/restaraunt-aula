import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { RequestContext } from '../../../../shared/infrastructure/context/request-context';
import { EventBus } from '../../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { NotFoundError } from '../../../../shared/kernel/errors';
import { Money } from '../../../../shared/kernel/money';
import { tryNormalizePhone } from '../../../../shared/kernel/phone';
import { Notifier } from '../../../notifications/public';
import { resolveDeliveryTarget } from '../../domain/certificate-order';
import { CertificateRecord, CertificateRepository, LedgerEntry } from '../../infrastructure/certificate.repository';
import { CertificateCreditedPayload, CertificateRedeemedPayload, PaymentsEvents } from '../../public';
import { certificateAuditState, formatAmount } from './certificate-views';

function currentActor(): Actor {
  return RequestContext.actor() ?? Actor.system();
}

export interface DebitCertificateInput {
  /** Сертификат, заблокированный (select ... for update) в текущей транзакции. */
  record: CertificateRecord;
  /** null — для набора: погашение целиком. */
  amount: Money | null;
  channel: 'order' | 'point';
  branchId: string | null;
  paymentId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  comment: string | null;
}

/**
 * Списание с сертификата (при оформлении заказа или на точке). Вызывается внутри транзакции
 * вместе с блокировкой строки сертификата: журнал движений, событие CertificateRedeemed,
 * аудит и уведомление держателю сертификата — в той же транзакции.
 */
@Injectable()
export class DebitCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(input: DebitCertificateInput): Promise<{ ledger: LedgerEntry; amount: Money; balanceAfter: Money }> {
    const now = this.clock.now();
    const actor = currentActor();
    const before = certificateAuditState(input.record);
    const { amount, balanceAfter } = input.record.certificate.debit(input.amount, now);
    await this.certificates.save(input.record.certificate);
    const ledger = await this.certificates.addLedger({
      certificateId: input.record.certificate.id,
      kind: 'debit',
      amount,
      balanceAfter,
      channel: input.channel,
      paymentId: input.paymentId,
      refundId: null,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      branchId: input.branchId,
      actorUserId: actor.userId,
      actorName: actor.name,
      comment: input.comment?.trim() || null,
      occurredAt: now,
    });
    await this.audit.record({
      action: 'certificate.redeemed',
      entityType: 'gift_certificate',
      entityId: input.record.certificate.id,
      branchId: input.branchId,
      before,
      after: certificateAuditState(input.record),
      meta: { amount: amount.toJSON(), channel: input.channel, referenceType: input.referenceType, referenceId: input.referenceId },
    });
    await this.events.publish(
      PaymentsEvents.CertificateRedeemed,
      {
        certificateId: input.record.certificate.id,
        amount: amount.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
        branchId: input.branchId,
        channel: input.channel,
        referenceId: input.referenceId,
        occurredAt: now.toISOString(),
      } satisfies CertificateRedeemedPayload,
      { aggregateId: input.record.certificate.id, branchId: input.branchId },
    );
    await this.notifyHolder(input.record, amount, balanceAfter, ledger.id);
    return { ledger, amount, balanceAfter };
  }

  /** Держателю — сообщение о списании (защита от незаметного использования чужого кода). */
  private async notifyHolder(record: CertificateRecord, amount: Money, balance: Money, ledgerId: string): Promise<void> {
    if (record.deliveryChannel === 'none') return;
    let target: { email: string | null; phone: string | null };
    try {
      target = resolveDeliveryTarget(
        record.deliveryChannel,
        { email: record.recipientEmail, phone: record.recipientPhone },
        { email: record.buyerEmail, phone: record.buyerPhone },
      );
    } catch {
      return;
    }
    await this.notifier.notifyGuest({
      recipient: { phone: tryNormalizePhone(target.phone), email: target.email, name: record.recipientName },
      template: 'certificate.redeemed',
      params: { amount: formatAmount(amount), balance: formatAmount(balance) },
      locale: record.locale,
      channels: target.email ? ['email'] : undefined,
      dedupeKey: `certificate:${record.certificate.id}:redeemed:${ledgerId}`,
      related: { type: 'gift_certificate', id: record.certificate.id },
    });
  }
}

/**
 * Возврат суммы на сертификат (отмена заказа, оплаченного сертификатом): журнал движений, аудит
 * и событие CertificateCredited — в транзакции возврата (обязательства по сертификатам снова растут).
 */
@Injectable()
export class CreditCertificate {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    certificateId: string;
    amount: Money;
    paymentId: string | null;
    refundId: string | null;
    branchId: string | null;
    comment: string | null;
  }): Promise<{ ledger: LedgerEntry; balanceAfter: Money }> {
    const now = this.clock.now();
    const actor = currentActor();
    const record = await this.certificates.findById(input.certificateId, { forUpdate: true });
    if (!record) throw new NotFoundError('certificate', input.certificateId);
    const before = certificateAuditState(record);
    const { balanceAfter } = record.certificate.credit(input.amount, now);
    await this.certificates.save(record.certificate);
    const ledger = await this.certificates.addLedger({
      certificateId: record.certificate.id,
      kind: 'credit',
      amount: input.amount,
      balanceAfter,
      channel: 'refund',
      paymentId: input.paymentId,
      refundId: input.refundId,
      referenceType: null,
      referenceId: null,
      branchId: input.branchId,
      actorUserId: actor.userId,
      actorName: actor.name,
      comment: input.comment,
      occurredAt: now,
    });
    await this.audit.record({
      action: 'certificate.credited',
      entityType: 'gift_certificate',
      entityId: record.certificate.id,
      branchId: input.branchId,
      before,
      after: certificateAuditState(record),
      meta: { amount: input.amount.toJSON(), refundId: input.refundId, paymentId: input.paymentId },
    });
    await this.events.publish(
      PaymentsEvents.CertificateCredited,
      {
        certificateId: record.certificate.id,
        amount: input.amount.toJSON(),
        balanceAfter: balanceAfter.toJSON(),
        branchId: input.branchId,
        refundId: input.refundId,
        paymentId: input.paymentId,
        occurredAt: now.toISOString(),
      } satisfies CertificateCreditedPayload,
      { aggregateId: record.certificate.id, branchId: input.branchId },
    );
    return { ledger, balanceAfter };
  }
}
