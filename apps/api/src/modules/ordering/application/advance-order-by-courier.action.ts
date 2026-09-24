import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { CourierDispatchStatus, orderTransitionsForDispatch } from '../domain/courier-dispatch';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderTransitionRecorder } from './order-transition-recorder';

/**
 * Статус курьера внешней службы двигает заказ доставки: курьер забрал — «в пути»,
 * доставил — «выполнен» (через delivering, как требует автомат для доставки). От имени системы.
 */
@Injectable()
export class AdvanceOrderByCourier {
  constructor(
    private readonly orders: OrderRepository,
    private readonly recorder: OrderTransitionRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string, dispatchStatus: CourierDispatchStatus): Promise<void> {
    await this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      if (!order || order.type !== 'delivery') return;
      const steps = orderTransitionsForDispatch(dispatchStatus, order.status);
      if (steps.length === 0) return;
      const before = order.auditView();
      const now = this.clock.now();
      for (const step of steps) {
        if (step === 'delivering') order.startDelivery(now);
        else order.complete(now);
      }
      await this.orders.save(order);
      await this.recorder.record(order, { actor: Actor.system('courier-dispatch'), before });
    });
  }
}
