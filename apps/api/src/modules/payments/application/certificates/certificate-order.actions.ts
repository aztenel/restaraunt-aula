import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { Clock } from '../../../../shared/kernel/clock';
import { CertificateOrderRepository } from '../../infrastructure/certificate-order.repository';
import { CertificateRepository } from '../../infrastructure/certificate.repository';
import { certificateAuditState } from './certificate-views';

/** Оплата заказа сертификатов не прошла (отказ провайдера, отмена по сроку). */
@Injectable()
export class MarkCertificateOrderPaymentFailed {
  constructor(
    private readonly orders: CertificateOrderRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string, paymentId: string, reason: string | null): Promise<void> {
    await this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      // Учитываем только текущий платёж заказа и только пока заказ ждёт оплату.
      if (!order || order.status !== 'awaiting_payment' || order.paymentId !== paymentId) return;
      await this.orders.transition(order, 'payment_failed', this.clock.now());
      await this.audit.record({
        action: 'certificate_order.payment_failed',
        entityType: 'certificate_order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'payment_failed' },
        meta: { paymentId, reason },
      });
    });
  }
}

/**
 * Покупка сертификатов возвращена полностью: неиспользованные сертификаты заказа блокируются,
 * чтобы по возвращённым деньгам нельзя было расплатиться.
 */
@Injectable()
export class BlockCertificatesOfRefundedOrder {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(orderId: string, refundId: string): Promise<number> {
    return this.database.transaction(async () => {
      let blocked = 0;
      for (const listed of await this.certificates.listByOrder(orderId)) {
        const record = (await this.certificates.findById(listed.certificate.id, { forUpdate: true }))!;
        if (record.certificate.status !== 'active' && record.certificate.status !== 'expired') continue;
        const before = certificateAuditState(record);
        record.certificate.block('purchase refunded');
        await this.certificates.save(record.certificate);
        await this.audit.record({
          action: 'certificate.blocked',
          entityType: 'gift_certificate',
          entityId: record.certificate.id,
          before,
          after: certificateAuditState(record),
          meta: { reason: 'purchase refunded', refundId },
        });
        blocked++;
      }
      return blocked;
    });
  }
}
