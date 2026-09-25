import { Injectable } from '@nestjs/common';
import { Money } from '../../../shared/kernel/money';
import { PaymentPurpose, PaymentsService, PaymentView } from '../../payments/public';
import { OrderPaymentPosition } from '../domain/payment-plan';
import { OrderPaymentLink, OrderPaymentsRepository, OrderRefundRecord } from '../infrastructure/order-payments.repository';

export interface OrderPaymentSnapshot {
  views: PaymentView[];
  links: OrderPaymentLink[];
  refunds: OrderRefundRecord[];
  positions: OrderPaymentPosition[];
}

/**
 * Платежи заказа глазами заказа: платежи модуля Payments (статусы, возвращённые суммы) + наши связи
 * (назначение части суммы) + запрошенные по заказу возвраты (ожидающие ещё не учтены в платеже).
 */
@Injectable()
export class OrderPaymentState {
  constructor(
    private readonly payments: PaymentsService,
    private readonly orderPayments: OrderPaymentsRepository,
  ) {}

  async load(orderId: string): Promise<OrderPaymentSnapshot> {
    const [views, links, refunds] = await Promise.all([
      this.payments.listForReference(PaymentPurpose.Order, orderId),
      this.orderPayments.listForOrder(orderId),
      this.orderPayments.refundsForOrder(orderId),
    ]);
    const positions = views.map(
      (v): OrderPaymentPosition => ({
        paymentId: v.id,
        method: v.method,
        status: v.status,
        amount: v.amount,
        refunded: v.refundedAmount,
        pendingRefunds: Money.sum(
          refunds.filter((r) => r.paymentId === v.id && r.status === 'pending').map((r) => r.amount),
          v.amount.currency,
        ),
      }),
    );
    return { views, links, refunds, positions };
  }
}
