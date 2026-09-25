import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { Actor } from '../../../shared/kernel/actor';
import { Money } from '../../../shared/kernel/money';
import { CustomerAnonymizedPayload, CustomersEvents } from '../../customers/public';
import { PaymentEventPayload, PaymentPurpose, PaymentsEvents, RefundEventPayload } from '../../payments/public';
import { AnonymizeBanquetContacts } from '../application/anonymize.action';
import { RecordInvoicePayment, RecordInvoiceRefund } from '../application/invoice.actions';
import { InvoiceRepository } from '../infrastructure/invoice.repository';

/**
 * Подписки модуля Banquet на события Payments: онлайн-оплата счёта (PaymentSucceeded, purpose banquet_invoice,
 * referenceId — id счёта) и прошедшие возвраты. Обработчики идемпотентны (платформа + уникальность платежа по счёту).
 */
@Injectable()
export class BanquetPaymentHandlers {
  private readonly logger = new Logger(BanquetPaymentHandlers.name);

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly recordPayment: RecordInvoicePayment,
    private readonly recordRefund: RecordInvoiceRefund,
  ) {}

  @OnEvent(PaymentsEvents.PaymentSucceeded)
  async onPaymentSucceeded(e: EventEnvelope<PaymentEventPayload>): Promise<void> {
    const p = e.payload;
    if (p.purpose !== PaymentPurpose.BanquetInvoice) return;
    const invoice = await this.invoices.findById(p.referenceId);
    if (!invoice) {
      this.logger.warn({ paymentId: p.paymentId, referenceId: p.referenceId }, 'Banquet payment for an unknown invoice');
      return;
    }
    await this.recordPayment.execute(
      { invoiceId: invoice.id, paymentId: p.paymentId, amount: Money.fromJson(p.amount), method: p.method, paidAt: new Date(p.occurredAt) },
      Actor.system('banquet.payments'),
    );
  }

  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(e: EventEnvelope<RefundEventPayload>): Promise<void> {
    const p = e.payload;
    if (p.purpose !== PaymentPurpose.BanquetInvoice) return;
    await this.recordRefund.execute(
      { paymentId: p.paymentId, refundId: p.refundId, amount: Money.fromJson(p.amount), reason: p.reason },
      Actor.system('banquet.payments'),
    );
  }
}

/** Обезличивание гостя в базе гостей — стираем снимки контакта в заявках. */
@Injectable()
export class BanquetCustomerHandlers {
  constructor(private readonly anonymize: AnonymizeBanquetContacts) {}

  @OnEvent(CustomersEvents.CustomerAnonymized)
  async onCustomerAnonymized(e: EventEnvelope<CustomerAnonymizedPayload>): Promise<void> {
    await this.anonymize.execute(e.payload.customerId);
  }
}
