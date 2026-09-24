import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import {
  BanquetEvents,
  BanquetInvoiceIssuedPayload,
  BanquetRequestCreatedPayload,
  BanquetStatusChangedPayload,
} from '../../banquet/public';
import { OrderCancelledPayload, OrderCompletedPayload, OrderingEvents, OrderPlacedPayload } from '../../ordering/public';
import { CertificateIssuedPayload, PaymentsEvents, RefundEventPayload } from '../../payments/public';
import { ReservationCreatedPayload, ReservationEvents, ReservationStatusChangedPayload } from '../../reservation/public';
import { RecordCustomerActivity } from '../application/record-activity.action';
import {
  fromBanquetInvoiceIssued,
  fromBanquetRequestCreated,
  fromBanquetStatusChanged,
  fromCertificateIssued,
  fromOrderCancelled,
  fromOrderCompleted,
  fromOrderPlaced,
  fromOrderRefund,
  fromReservationCreated,
  fromReservationStatusChanged,
  Projection,
} from '../domain/history';

/**
 * История гостя: проекция событий заказов, броней, банкетов и сертификатов в схему customers.
 * Обработчики выполняются платформой в транзакции, однократно на событие; в чужие таблицы не ходят —
 * всё нужное есть в payload событий.
 */
@Injectable()
export class CustomersHistoryProjection {
  constructor(private readonly record: RecordCustomerActivity) {}

  private async project(event: EventEnvelope<unknown>, projection: Projection | null): Promise<void> {
    if (!projection) return;
    await this.record.execute({ ...projection, sourceEventId: event.id });
  }

  @OnEvent(OrderingEvents.OrderPlaced)
  async onOrderPlaced(event: EventEnvelope<OrderPlacedPayload>): Promise<void> {
    await this.project(event, fromOrderPlaced(event.payload));
  }

  @OnEvent(OrderingEvents.OrderCompleted)
  async onOrderCompleted(event: EventEnvelope<OrderCompletedPayload>): Promise<void> {
    await this.project(event, fromOrderCompleted(event.payload));
  }

  @OnEvent(OrderingEvents.OrderCancelled)
  async onOrderCancelled(event: EventEnvelope<OrderCancelledPayload>): Promise<void> {
    await this.project(event, fromOrderCancelled(event.payload));
  }

  /** Возврат по выполненному заказу уменьшает сумму покупок гостя. */
  @OnEvent(PaymentsEvents.RefundSucceeded)
  async onRefundSucceeded(event: EventEnvelope<RefundEventPayload>): Promise<void> {
    const projection = fromOrderRefund(event.payload);
    if (!projection) return;
    await this.record.execute({ ...projection, ref: null, sourceEventId: event.id, completedOrderId: event.payload.referenceId });
  }

  @OnEvent(ReservationEvents.ReservationCreated)
  async onReservationCreated(event: EventEnvelope<ReservationCreatedPayload>): Promise<void> {
    await this.project(event, fromReservationCreated(event.payload));
  }

  @OnEvent(ReservationEvents.ReservationStatusChanged)
  async onReservationStatusChanged(event: EventEnvelope<ReservationStatusChangedPayload>): Promise<void> {
    await this.project(event, fromReservationStatusChanged(event.payload));
  }

  @OnEvent(BanquetEvents.RequestCreated)
  async onBanquetRequestCreated(event: EventEnvelope<BanquetRequestCreatedPayload>): Promise<void> {
    const p = event.payload;
    await this.record.execute({
      ...fromBanquetRequestCreated(p),
      sourceEventId: event.id,
      banquetRequest: { requestId: p.requestId, number: p.number, mode: 'link' },
    });
  }

  @OnEvent(BanquetEvents.StatusChanged)
  async onBanquetStatusChanged(event: EventEnvelope<BanquetStatusChangedPayload>): Promise<void> {
    const p = event.payload;
    await this.record.execute({
      ...fromBanquetStatusChanged(p),
      sourceEventId: event.id,
      banquetRequest: { requestId: p.requestId, number: p.number, mode: 'link' },
    });
  }

  /** Счёт юрлицу — гость заявки получает тег corporate. */
  @OnEvent(BanquetEvents.InvoiceIssued)
  async onBanquetInvoiceIssued(event: EventEnvelope<BanquetInvoiceIssuedPayload>): Promise<void> {
    const p = event.payload;
    await this.record.execute({
      ...fromBanquetInvoiceIssued(p),
      ref: null,
      sourceEventId: event.id,
      banquetRequest: { requestId: p.requestId, number: p.number, mode: 'lookup' },
    });
  }

  @OnEvent(PaymentsEvents.CertificateIssued)
  async onCertificateIssued(event: EventEnvelope<CertificateIssuedPayload>): Promise<void> {
    await this.project(event, fromCertificateIssued(event.payload));
  }
}
