import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { OrderCancelledPayload, OrderingEvents, OrderStatus, OrderStatusChangedPayload } from '../../ordering/public';
import { HandleCancelledOrder, RegisterOrderExport } from '../application/order-export.actions';

/**
 * Подписки на события заказов. Приём заказа от POS не зависит: запись о передаче создаётся
 * после коммита приёма, сама передача — задачей в очереди.
 */
@Injectable()
export class PosOrderEventsHandler {
  constructor(
    private readonly registerExport: RegisterOrderExport,
    private readonly handleCancelled: HandleCancelledOrder,
  ) {}

  @OnEvent(OrderingEvents.OrderStatusChanged)
  async onOrderStatusChanged(event: EventEnvelope<OrderStatusChangedPayload>): Promise<void> {
    const p = event.payload;
    if (p.to !== OrderStatus.Accepted) return;
    await this.registerExport.execute({ orderId: p.orderId, number: p.number, branchId: p.branchId });
  }

  @OnEvent(OrderingEvents.OrderCancelled)
  async onOrderCancelled(event: EventEnvelope<OrderCancelledPayload>): Promise<void> {
    await this.handleCancelled.execute({ orderId: event.payload.orderId });
  }
}
