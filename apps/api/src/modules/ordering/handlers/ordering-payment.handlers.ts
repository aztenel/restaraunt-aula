import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { PaymentEventPayload, PaymentsEvents, RefundEventPayload } from '../../payments/public';
import { ApplyOrderPayment, ApplyOrderRefundResult } from '../application/order-payment-events.actions';

/**
 * Подписки на события платёжного модуля (в транзакции, однократно на событие). PaymentFailed /
 * PaymentCancelled не обрабатываются: заказ остаётся «ожидает оплаты» до повтора оплаты или автоотмены.
 */
@Injectable()
export class OrderingPaymentHandlers {
  constructor(
    private readonly applyPayment: ApplyOrderPayment,
    private readonly applyRefund: ApplyOrderRefundResult,
  ) {}

  @OnEvent(PaymentsEvents.PaymentSucceeded)
  async onPaymentSucceeded(event: EventEnvelope<PaymentEventPayload>): Promise<void> {
    await this.applyPayment.execute(event.payload);
  }

  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(event: EventEnvelope<RefundEventPayload>): Promise<void> {
    await this.applyRefund.execute(event.payload, 'succeeded');
  }

  @OnEvent(PaymentsEvents.RefundFailed)
  async onRefundFailed(event: EventEnvelope<RefundEventPayload>): Promise<void> {
    await this.applyRefund.execute(event.payload, 'failed');
  }
}
