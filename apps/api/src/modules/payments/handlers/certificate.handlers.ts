import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import {
  ApplyCertificateOrderPayment,
  BlockCertificatesOfRefundedOrder,
  MarkCertificateOrderPaymentFailed,
} from '../application/certificates/certificate-order.actions';
import { PaymentEventPayload, PaymentsEvents, RefundEventPayload } from '../public';

/**
 * Подписки модуля на собственные события платежей с purpose=gift_certificate:
 * выпуск сертификатов по оплате, отказ оплаты заказа, блокировка при полном возврате покупки.
 */
@Injectable()
export class CertificatePaymentHandlers {
  constructor(
    private readonly applyPayment: ApplyCertificateOrderPayment,
    private readonly markFailed: MarkCertificateOrderPaymentFailed,
    private readonly blockRefunded: BlockCertificatesOfRefundedOrder,
  ) {}

  @OnEvent(PaymentsEvents.PaymentSucceeded)
  async onPaymentSucceeded(event: EventEnvelope<PaymentEventPayload>): Promise<void> {
    if (event.payload.purpose !== 'gift_certificate') return;
    await this.applyPayment.execute(event.payload.referenceId, event.payload.paymentId);
  }

  @OnEvent(PaymentsEvents.PaymentFailed, PaymentsEvents.PaymentCancelled)
  async onPaymentFailed(event: EventEnvelope<PaymentEventPayload>): Promise<void> {
    if (event.payload.purpose !== 'gift_certificate') return;
    await this.markFailed.execute(event.payload.referenceId, event.payload.paymentId, event.payload.reason ?? null);
  }

  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(event: EventEnvelope<RefundEventPayload>): Promise<void> {
    if (event.payload.purpose !== 'gift_certificate' || !event.payload.referenceFullyRefunded) return;
    await this.blockRefunded.execute(event.payload.referenceId, event.payload.refundId);
  }
}
