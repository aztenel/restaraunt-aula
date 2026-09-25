import { Injectable, Logger } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { addMinutes } from '../../../shared/kernel/time';
import { BranchDirectory } from '../../identity/public';
import { OrderRepository } from '../infrastructure/order.repository';
import { CancelOrder } from './order-staff.actions';

export const AUTO_CANCEL_SCHEDULE = 'ordering.auto_cancel_unpaid';

/**
 * Автоотмена неоплаченных заказов (раз в минуту): заказ в awaiting_payment дольше
 * awaitingPaymentTimeoutMinutes филиала отменяется с причиной not_paid_in_time — платёж отменяется,
 * промокод освобождается, списание с сертификата возвращается. Каждый заказ — своя транзакция.
 */
@Injectable()
export class AutoCancelUnpaidOrders {
  private readonly logger = new Logger(AutoCancelUnpaidOrders.name);

  constructor(
    private readonly branches: BranchDirectory,
    private readonly orders: OrderRepository,
    private readonly cancelOrder: CancelOrder,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const actor = Actor.system('ordering.auto_cancel');
    let cancelled = 0;
    for (const branch of await this.branches.list()) {
      const cutoff = addMinutes(now, -branch.settings.awaitingPaymentTimeoutMinutes);
      for (const orderId of await this.orders.awaitingPaymentPlacedBefore(branch.id, cutoff)) {
        try {
          const result = await this.cancelOrder.execute(actor, orderId, {
            reasonCode: 'not_paid_in_time',
            reason: null,
            expectedStatus: 'awaiting_payment',
          });
          if (result) cancelled++;
        } catch (err) {
          this.logger.error({ orderId, err: err instanceof Error ? err.message : String(err) }, 'Auto-cancel of unpaid order failed');
        }
      }
    }
    return cancelled;
  }
}
