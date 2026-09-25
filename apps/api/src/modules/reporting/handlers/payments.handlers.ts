import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { Money } from '../../../shared/kernel/money';
import {
  CertificateCreditedPayload,
  CertificateExpiredPayload,
  CertificateIssuedPayload,
  CertificateRedeemedPayload,
  CertificateReinstatedPayload,
  PaymentEventPayload,
  PaymentsEvents,
  RefundEventPayload,
} from '../../payments/public';
import { RecognizeRefundRevenue } from '../application/recognize-refund-revenue.action';
import { localDateOf } from '../domain/period';
import { certificateSale, orderRevenueAmount, SalesSourceType } from '../domain/revenue';
import { CertificateFactsRepository } from '../infrastructure/certificate-facts.repository';
import { OrderFactsRepository } from '../infrastructure/order-facts.repository';
import { PaymentFactsRepository } from '../infrastructure/payment-facts.repository';
import { SalesFactsRepository } from '../infrastructure/sales-facts.repository';

/**
 * Проекция поступлений, возвратов и сертификатов из событий Payments.
 * Поступления (PaymentSucceeded) — отчёт «Движение денег»; возврат по признанной выручке —
 * отрицательная строка выручки в день возврата; продажа сертификата — выручка при продаже.
 */
@Injectable()
export class ReportingPaymentsProjection {
  constructor(
    private readonly payments: PaymentFactsRepository,
    private readonly certificates: CertificateFactsRepository,
    private readonly sales: SalesFactsRepository,
    private readonly recognizeRefund: RecognizeRefundRevenue,
    private readonly orders: OrderFactsRepository,
  ) {}

  @OnEvent(PaymentsEvents.PaymentSucceeded)
  async onPaymentSucceeded(e: EventEnvelope<PaymentEventPayload>): Promise<void> {
    const p = e.payload;
    const paidAt = new Date(p.occurredAt);
    await this.payments.insertPayment({
      paymentId: p.paymentId,
      purpose: p.purpose,
      referenceId: p.referenceId,
      branchId: p.branchId,
      method: p.method,
      provider: p.provider,
      amount: Money.fromJson(p.amount),
      paidAt,
      paidDate: localDateOf(paidAt),
      late: p.previousStatus === 'failed' || p.previousStatus === 'cancelled',
    });
    // Оплата заказа сертификатом пришла после признания выручки заказа (события не по порядку):
    // выручка заказа — итог минус оплаченное сертификатом.
    if (p.purpose === 'order' && p.method === 'gift_certificate') {
      const total = await this.orders.completedTotal(p.referenceId);
      if (total) {
        const certificatePaid = await this.payments.capturedAmount('order', p.referenceId, 'gift_certificate');
        await this.sales.setSaleAmount(SalesSourceType.Order, p.referenceId, orderRevenueAmount(total, certificatePaid));
      }
    }
  }

  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(e: EventEnvelope<RefundEventPayload>): Promise<void> {
    const p = e.payload;
    const refundedAt = new Date(p.occurredAt);
    await this.payments.insertRefund({
      refundId: p.refundId,
      paymentId: p.paymentId,
      purpose: p.purpose,
      referenceId: p.referenceId,
      branchId: p.branchId,
      amount: Money.fromJson(p.amount),
      reason: p.reason ?? '',
      refundedAt,
      refundedDate: localDateOf(refundedAt),
      paymentFullyRefunded: p.paymentFullyRefunded,
      referenceFullyRefunded: p.referenceFullyRefunded,
    });
    await this.recognizeRefund.execute(p.refundId);
  }

  @OnEvent(PaymentsEvents.CertificateIssued)
  async onCertificateIssued(e: EventEnvelope<CertificateIssuedPayload>): Promise<void> {
    const p = e.payload;
    const issuedAt = new Date(p.occurredAt);
    const price = Money.fromJson(p.price);
    await this.certificates.applyIssued({
      certificateId: p.certificateId,
      productId: p.productId,
      kind: p.kind,
      nominal: Money.fromJson(p.nominal),
      price,
      branchId: p.branchId,
      issuedAt,
      issuedDate: localDateOf(issuedAt),
    });
    await this.sales.insert(certificateSale({ certificateId: p.certificateId, branchId: p.branchId, price, issuedAt }));
  }

  @OnEvent(PaymentsEvents.CertificateRedeemed)
  async onCertificateRedeemed(e: EventEnvelope<CertificateRedeemedPayload>): Promise<void> {
    const p = e.payload;
    const redeemedAt = new Date(p.occurredAt);
    await this.certificates.insertRedemption({
      eventId: e.id,
      certificateId: p.certificateId,
      amount: Money.fromJson(p.amount),
      balanceAfter: Money.fromJson(p.balanceAfter),
      branchId: p.branchId,
      channel: p.channel,
      referenceId: p.referenceId,
      redeemedAt,
      redeemedDate: localDateOf(redeemedAt),
    });
  }

  /** Возврат на сертификат (отмена заказа, оплаченного сертификатом): обязательства снова растут. */
  @OnEvent(PaymentsEvents.CertificateCredited)
  async onCertificateCredited(e: EventEnvelope<CertificateCreditedPayload>): Promise<void> {
    const p = e.payload;
    const creditedAt = new Date(p.occurredAt);
    await this.certificates.insertCredit({
      eventId: e.id,
      certificateId: p.certificateId,
      amount: Money.fromJson(p.amount),
      balanceAfter: Money.fromJson(p.balanceAfter),
      branchId: p.branchId,
      refundId: p.refundId,
      paymentId: p.paymentId,
      creditedAt,
      creditedDate: localDateOf(creditedAt),
    });
  }

  /** Продление истёкшего сертификата: остаток снова в обязательствах (снимаем «сгоревший» остаток). */
  @OnEvent(PaymentsEvents.CertificateReinstated)
  async onCertificateReinstated(e: EventEnvelope<CertificateReinstatedPayload>): Promise<void> {
    await this.certificates.applyReinstated({ certificateId: e.payload.certificateId, expiresAt: new Date(e.payload.expiresAt) });
  }

  @OnEvent(PaymentsEvents.CertificateExpired)
  async onCertificateExpired(e: EventEnvelope<CertificateExpiredPayload>): Promise<void> {
    const p = e.payload;
    const expiredAt = new Date(p.occurredAt);
    await this.certificates.applyExpired({
      certificateId: p.certificateId,
      kind: p.kind,
      nominal: Money.fromJson(p.nominal),
      balance: Money.fromJson(p.balance),
      expiresAt: new Date(p.expiresAt),
      expiredAt,
      expiredDate: localDateOf(expiredAt),
    });
  }
}
