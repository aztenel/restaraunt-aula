import { Injectable } from '@nestjs/common';
import { PaymentsService, PaymentView, RefundView } from '../../payments/public';
import { InvoicePaymentRecord, InvoiceRecord } from '../infrastructure/invoice.repository';

/** Платёжные сведения счетов для админки: текущая ссылка онлайн-оплаты и возвраты по поступлениям. */
export interface InvoicePaymentsExtras {
  /** Текущий онлайн-платёж счёта физлица (по id счёта). */
  currentPayments: Map<string, PaymentView>;
  /** Возвраты по поступлениям (все статусы). */
  refunds: RefundView[];
}

/** Ссылка онлайн-оплаты действует, пока платёж ждёт оплату. */
export function activePaymentUrl(payment: PaymentView | undefined): string | null {
  if (!payment) return null;
  return payment.status === 'created' || payment.status === 'pending' ? payment.paymentUrl : null;
}

@Injectable()
export class InvoicePaymentsInfo {
  constructor(private readonly payments: PaymentsService) {}

  async load(invoices: readonly InvoiceRecord[], payments: readonly InvoicePaymentRecord[]): Promise<InvoicePaymentsExtras> {
    const currentPayments = new Map<string, PaymentView>();
    for (const invoice of invoices) {
      if (!invoice.paymentId) continue;
      try {
        currentPayments.set(invoice.id, await this.payments.getPayment(invoice.paymentId));
      } catch {
        // Платёж недоступен (удалён/не найден) — ссылка просто не показывается.
      }
    }
    const refunds = await this.payments.listRefunds([...new Set(payments.map((p) => p.paymentId))]);
    return { currentPayments, refunds };
  }
}
