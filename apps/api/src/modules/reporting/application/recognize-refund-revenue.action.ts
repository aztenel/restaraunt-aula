import { Injectable } from '@nestjs/common';
import { refundRevenueFact, RefundTarget } from '../domain/revenue';
import { BanquetFactsRepository } from '../infrastructure/banquet-facts.repository';
import { OrderFactsRepository } from '../infrastructure/order-facts.repository';
import { PaymentFactsRepository } from '../infrastructure/payment-facts.repository';
import { SalesFactsRepository } from '../infrastructure/sales-facts.repository';

/**
 * Возврат по признанной выручке → отрицательная строка выручки в день возврата
 * (правило в domain/revenue.refundRevenueFact). Вызывается при RefundSucceeded и повторно,
 * когда признаётся выручка объекта (события могут прийти не по порядку). Идемпотентно:
 * одна строка на возврат.
 */
@Injectable()
export class RecognizeRefundRevenue {
  constructor(
    private readonly payments: PaymentFactsRepository,
    private readonly orders: OrderFactsRepository,
    private readonly banquets: BanquetFactsRepository,
    private readonly sales: SalesFactsRepository,
  ) {}

  async execute(refundId: string): Promise<boolean> {
    const refund = await this.payments.findRefund(refundId);
    if (!refund) return false;
    const target: RefundTarget = {};
    if (refund.purpose === 'order') {
      target.order = await this.orders.findForRefund(refund.referenceId);
    } else if (refund.purpose === 'banquet_invoice') {
      // referenceId платежа по банкету — счёт; заявку находим по проекции счетов (или это сама заявка).
      const requestId = (await this.banquets.requestOfInvoice(refund.referenceId)) ?? refund.referenceId;
      target.banquet = await this.banquets.findForRefund(requestId);
    }
    const fact = refundRevenueFact(
      {
        refundId: refund.refundId,
        purpose: refund.purpose,
        referenceId: refund.referenceId,
        branchId: refund.branchId,
        amount: refund.amount,
        refundedAt: refund.refundedAt,
      },
      target,
    );
    return fact ? this.sales.insert(fact) : false;
  }
}
