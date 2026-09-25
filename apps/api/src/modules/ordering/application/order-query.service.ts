import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel/errors';
import { DeliveryDetails } from '../domain/order';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { KitchenOrder, OrderQuery } from '../public';

/** Адрес доставки одной строкой для кухни и курьера: улица, квартира, подъезд, этаж, домофон. */
function formatAddress(d: DeliveryDetails): string {
  const parts = [
    d.addressText,
    d.apartment ? `кв./офис ${d.apartment}` : null,
    d.entrance ? `подъезд ${d.entrance}` : null,
    d.floor ? `этаж ${d.floor}` : null,
    d.intercom ? `домофон ${d.intercom}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

/**
 * Реализация контракта OrderQuery: заказ для передачи на кухню (POS). Позиции — снимки на момент
 * заказа; «оплачен онлайн» — к получению с гостя ничего не остаётся (онлайн и/или сертификат).
 */
@Injectable()
export class OrderQueryService extends OrderQuery {
  constructor(
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
  ) {
    super();
  }

  async getKitchenOrder(orderId: string): Promise<KitchenOrder> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundError('order', orderId);
    const s = order.snapshot();
    const links = await this.orderPayments.listForOrder(order.id);
    const delivery = s.delivery;
    const notes = [s.comment, s.contactless ? 'Бесконтактная доставка' : null, delivery?.courierComment ? `Курьеру: ${delivery.courierComment}` : null];
    return {
      orderId: s.id,
      number: s.number,
      branchId: s.branchId,
      type: s.type,
      status: s.status,
      items: s.items.map((i) => ({
        dishId: i.dishId,
        sku: i.sku,
        name: i.name,
        quantity: i.quantity,
        modifiers: i.modifiers.map((m) => ({ optionId: m.optionId, name: m.optionName })),
        unitPrice: i.unitPrice.toJSON(),
      })),
      comment: notes.filter(Boolean).join('. ') || null,
      scheduledFor: s.scheduledFor?.toISOString() ?? null,
      customer: { name: s.customer.name, phone: s.customer.phone },
      deliveryAddress: delivery ? formatAddress(delivery) : null,
      total: s.totals.total.toJSON(),
      paymentMethod: s.paymentMethod,
      isPaidOnline: !links.some((l) => l.kind === 'on_receipt'),
      placedAt: s.timestamps.placedAt.toISOString(),
    };
  }
}
