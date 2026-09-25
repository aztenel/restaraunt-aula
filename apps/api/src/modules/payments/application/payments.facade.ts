import { Injectable } from '@nestjs/common';
import { Money } from '../../../shared/kernel/money';
import { CreatePaymentCommand, PaymentPurpose, PaymentsService, PaymentView, RefundView } from '../public';
import { CreatePayment } from './create-payment.action';
import { PaymentQueries } from './payment.queries';
import { CancelPayment, MarkCollected } from './payment-status.actions';
import { RefundRepository } from '../infrastructure/refund.repository';
import { RequestRefund } from './refund.actions';
import { RegisterBankTransfer } from './register-bank-transfer.action';

/**
 * Реализация публичного контракта PaymentsService. Каждый метод — делегирование одному действию
 * (правило 3 ТЗ): бизнес-логика живёт в действиях и домене.
 */
@Injectable()
export class PaymentsFacade extends PaymentsService {
  constructor(
    private readonly create: CreatePayment,
    private readonly queries: PaymentQueries,
    private readonly cancel: CancelPayment,
    private readonly refund: RequestRefund,
    private readonly collect: MarkCollected,
    private readonly bankTransfer: RegisterBankTransfer,
    private readonly refunds: RefundRepository,
  ) {
    super();
  }

  createPayment(cmd: CreatePaymentCommand): Promise<PaymentView> {
    return this.create.execute(cmd);
  }

  getPayment(paymentId: string): Promise<PaymentView> {
    return this.queries.get(paymentId);
  }

  listForReference(purpose: PaymentPurpose, referenceId: string): Promise<PaymentView[]> {
    return this.queries.listForReference(purpose, referenceId);
  }

  async cancelPayment(paymentId: string, reason: string): Promise<void> {
    await this.cancel.execute(paymentId, reason);
  }

  requestRefund(input: { paymentId: string; amount?: Money; reason: string; idempotencyKey: string }): Promise<RefundView> {
    return this.refund.execute(input);
  }

  async listRefunds(paymentIds: string[]): Promise<RefundView[]> {
    return (await this.refunds.listForPayments(paymentIds)).map((r) => r.toView());
  }

  async markCollected(paymentId: string): Promise<void> {
    await this.collect.execute(paymentId);
  }

  registerBankTransfer(input: {
    purpose: PaymentPurpose;
    referenceId: string;
    branchId: string | null;
    amount: Money;
    paidAt: Date;
    documentNumber: string;
    idempotencyKey: string;
  }): Promise<PaymentView> {
    return this.bankTransfer.execute(input);
  }
}
