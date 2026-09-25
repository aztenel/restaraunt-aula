import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../../shared/kernel/errors';
import { Money, MoneyJson } from '../../../../shared/kernel/money';
import { CertificateOrder, CertificateOrderRepository } from '../../infrastructure/certificate-order.repository';
import { CertificateProductRepository } from '../../infrastructure/certificate-product.repository';
import { CertificateRepository } from '../../infrastructure/certificate.repository';
import { PaymentView } from '../../public';
import { CreatePayment } from '../create-payment.action';
import { PaymentLinks } from '../payment-links';
import { PaymentQueries } from '../payment.queries';
import { certificateAuditState } from './certificate-views';
import { certificatePaymentDescription } from './purchase-certificate.action';

/** Оплата заказа сертификатов не прошла (отказ провайдера, отмена по сроку). */
@Injectable()
export class MarkCertificateOrderPaymentFailed {
  constructor(
    private readonly orders: CertificateOrderRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string, paymentId: string, reason: string | null): Promise<void> {
    await this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      // Учитываем только текущий платёж заказа и только пока заказ ждёт оплату.
      if (!order || order.status !== 'awaiting_payment' || order.paymentId !== paymentId) return;
      await this.orders.transition(order, 'payment_failed', this.clock.now());
      await this.audit.record({
        action: 'certificate_order.payment_failed',
        entityType: 'certificate_order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'payment_failed' },
        meta: { paymentId, reason },
      });
    });
  }
}

/**
 * Покупка сертификатов возвращена полностью: неиспользованные сертификаты заказа блокируются,
 * чтобы по возвращённым деньгам нельзя было расплатиться.
 */
@Injectable()
export class BlockCertificatesOfRefundedOrder {
  constructor(
    private readonly certificates: CertificateRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(orderId: string, refundId: string): Promise<number> {
    return this.database.transaction(async () => {
      let blocked = 0;
      for (const listed of await this.certificates.listByOrder(orderId)) {
        const record = (await this.certificates.findById(listed.certificate.id, { forUpdate: true }))!;
        if (record.certificate.status !== 'active' && record.certificate.status !== 'expired') continue;
        const before = certificateAuditState(record);
        record.certificate.block('purchase refunded');
        await this.certificates.save(record.certificate);
        await this.audit.record({
          action: 'certificate.blocked',
          entityType: 'gift_certificate',
          entityId: record.certificate.id,
          before,
          after: certificateAuditState(record),
          meta: { reason: 'purchase refunded', refundId },
        });
        blocked++;
      }
      return blocked;
    });
  }
}

/**
 * Повтор оплаты заказа сертификатов со страницы заказа (как у заказов доставки): прошлая попытка
 * отклонена или отменена по сроку. Пока текущий платёж ждёт оплату — возвращается он же (идемпотентно).
 * Заказ payment_failed возвращается в awaiting_payment, создаётся новый онлайн-платёж на ту же сумму.
 */
@Injectable()
export class RetryCertificateOrderPayment {
  constructor(
    private readonly orders: CertificateOrderRepository,
    private readonly products: CertificateProductRepository,
    private readonly createPayment: CreatePayment,
    private readonly paymentQueries: PaymentQueries,
    private readonly links: PaymentLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<{ order: CertificateOrder; payment: PaymentView }> {
    return this.database.transaction(async () => {
      const found = await this.orders.findByToken(token);
      if (!found) throw new NotFoundError('certificate_order');
      const order = (await this.orders.findById(found.id, { forUpdate: true }))!;
      if (order.source !== 'online') {
        throw new ConflictError('certificate_order.payment_retry_not_available', 'Online payment is not used for this order');
      }
      if (order.status === 'issued') throw new ConflictError('certificate_order.already_paid', 'The order has already been paid');
      const current = order.paymentId ? await this.paymentQueries.get(order.paymentId) : null;
      if (current && (current.status === 'created' || current.status === 'pending')) return { order, payment: current };
      if (current && current.status !== 'failed' && current.status !== 'cancelled') {
        throw new ConflictError('certificate_order.already_paid', 'The payment has already been made', { paymentStatus: current.status });
      }
      const product = await this.products.findById(order.productId);
      if (!product || !product.isActive) {
        throw new ConflictError('certificate_order.product_unavailable', 'The certificate is no longer for sale');
      }
      const now = this.clock.now();
      const reopened = order.status === 'payment_failed' ? await this.orders.transition(order, 'awaiting_payment', now) : order;
      const attempt = (await this.paymentQueries.listForReference('gift_certificate', order.id)).filter((p) => p.method === 'online').length;
      const payment = await this.createPayment.execute({
        purpose: 'gift_certificate',
        referenceId: order.id,
        branchId: null,
        method: 'online',
        amount: order.total,
        description: certificatePaymentDescription(
          { name: order.product.name, nominal: Money.fromJson(order.product.nominal as MoneyJson) },
          order.quantity,
          order.locale,
        ),
        customer: { phone: order.buyer.phone, name: order.buyer.name, email: order.buyer.email },
        returnUrl: this.links.certificateOrderUrl(order.token, order.locale),
        idempotencyKey: `certificate-order:${order.id}:${attempt}`,
      });
      await this.orders.attachPayment(order.id, payment.id);
      await this.audit.record({
        action: 'certificate_order.payment_retried',
        entityType: 'certificate_order',
        entityId: order.id,
        before: { status: order.status, paymentId: order.paymentId, paymentStatus: current?.status ?? null },
        after: { status: reopened.status, paymentId: payment.id, attempt, total: order.total.toJSON() },
        actor: Actor.guest(),
      });
      return { order: { ...reopened, paymentId: payment.id }, payment };
    });
  }
}
