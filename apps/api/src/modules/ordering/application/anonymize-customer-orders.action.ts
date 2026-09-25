import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Actor } from '../../../shared/kernel/actor';
import { OrderRepository } from '../infrastructure/order.repository';

/**
 * Обезличивание заказов гостя по требованию (закон РК о ПД, событие CustomerAnonymized):
 * контакты, адрес и комментарии стираются, суммы и позиции остаются для отчётов.
 */
@Injectable()
export class AnonymizeCustomerOrders {
  constructor(
    private readonly orders: OrderRepository,
    private readonly audit: AuditLog,
  ) {}

  async execute(customerId: string): Promise<number> {
    const ids = await this.orders.idsByCustomer(customerId);
    for (const id of ids) {
      const order = await this.orders.findById(id, { forUpdate: true });
      if (!order) continue;
      order.anonymize();
      await this.orders.save(order);
    }
    if (ids.length > 0) {
      await this.audit.record({
        action: 'order.customer_anonymized',
        entityType: 'customer',
        entityId: customerId,
        after: { orders: ids.length },
        actor: Actor.system('customers'),
      });
    }
    return ids.length;
  }
}
