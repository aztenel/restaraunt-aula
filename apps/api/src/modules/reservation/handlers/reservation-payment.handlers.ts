import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { PaymentEventPayload, PaymentsEvents, RefundEventPayload } from '../../payments/public';
import { ApplyDepositPayment, RecordDepositRefund } from '../application/deposit-events.actions';

/**
 * События модуля Payments по депозитам броней (purpose reservation_deposit). Обработчики выполняются
 * в транзакции платформы, ровно один раз на событие; повтор того же платежа домен тоже распознаёт.
 */
@Injectable()
export class ReservationPaymentHandlers {
  constructor(
    private readonly applyDeposit: ApplyDepositPayment,
    private readonly recordRefund: RecordDepositRefund,
  ) {}

  @OnEvent(PaymentsEvents.PaymentSucceeded)
  async onPaymentSucceeded(e: EventEnvelope<PaymentEventPayload>): Promise<void> {
    await this.applyDeposit.execute(e.payload);
  }

  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(e: EventEnvelope<RefundEventPayload>): Promise<void> {
    await this.recordRefund.execute(e.payload, true);
  }

  @OnEvent(PaymentsEvents.RefundFailed)
  async onRefundFailed(e: EventEnvelope<RefundEventPayload>): Promise<void> {
    await this.recordRefund.execute(e.payload, false);
  }
}
