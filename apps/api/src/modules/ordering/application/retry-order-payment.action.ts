import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { addMinutes } from '../../../shared/kernel/time';
import { BranchDirectory } from '../../identity/public';
import { PaymentsService, PaymentView } from '../../payments/public';
import { Order } from '../domain/order';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderLinks } from './order-links';

/**
 * Повтор онлайн-оплаты со страницы статуса заказа: прошлая попытка отклонена или отменена, заказ всё ещё
 * ждёт оплаты и срок оплаты не истёк. Пока текущая попытка не завершена — возвращается она же (идемпотентно).
 */
@Injectable()
export class RetryOrderPayment {
  constructor(
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly payments: PaymentsService,
    private readonly branches: BranchDirectory,
    private readonly links: OrderLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(publicToken: string): Promise<{ order: Order; payment: PaymentView }> {
    return this.database.transaction(async () => {
      const found = await this.orders.findByPublicToken(publicToken);
      if (!found) throw new NotFoundError('order');
      const order = (await this.orders.findById(found.id, { forUpdate: true }))!;
      const s = order.snapshot();
      if (s.status !== 'awaiting_payment') {
        throw new ConflictError('order.not_awaiting_payment', 'The order does not wait for payment', { status: s.status });
      }
      if (s.paymentMethod !== 'online') {
        throw new ConflictError('order.payment_retry_not_available', 'Online payment is not used for this order');
      }
      const online = (await this.orderPayments.listForOrder(order.id)).filter((l) => l.kind === 'online');
      const last = online.sort((a, b) => b.attempt - a.attempt)[0];
      if (!last) throw new ConflictError('order.payment_retry_not_available', 'Online payment is not used for this order');
      const current = await this.payments.getPayment(last.paymentId);
      if (current.status === 'created' || current.status === 'pending') return { order, payment: current };
      if (current.status !== 'failed' && current.status !== 'cancelled') {
        throw new ConflictError('order.already_paid', 'The payment has already been made', { paymentStatus: current.status });
      }
      const branch = await this.branches.get(order.branchId);
      const deadline = addMinutes(s.timestamps.placedAt, branch.settings.awaitingPaymentTimeoutMinutes);
      if (this.clock.now().getTime() >= deadline.getTime()) {
        throw new ConflictError('order.payment_expired', 'The time to pay for the order has expired');
      }
      const attempt = last.attempt + 1;
      const payment = await this.payments.createPayment({
        purpose: 'order',
        referenceId: order.id,
        branchId: order.branchId,
        method: 'online',
        amount: last.amount,
        description: `Заказ ${s.number}`,
        customer: { phone: s.customer.phone, name: s.customer.name, email: s.customer.email },
        returnUrl: this.links.tracking(s.publicToken, s.locale),
        idempotencyKey: `order:${order.id}:online:${attempt}`,
        expiresAt: deadline,
      });
      await this.orderPayments.link({ paymentId: payment.id, orderId: order.id, kind: 'online', attempt, amount: last.amount });
      order.setCurrentPayment(payment.id);
      await this.orders.save(order);
      await this.audit.record({
        action: 'order.payment_retried',
        entityType: 'order',
        entityId: order.id,
        branchId: order.branchId,
        before: { paymentId: current.id, paymentStatus: current.status },
        after: { paymentId: payment.id, attempt, amount: last.amount.toJSON() },
      });
      return { order, payment };
    });
  }
}
