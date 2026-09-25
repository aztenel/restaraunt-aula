import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { Actor } from '../../../../shared/kernel/actor';
import { Clock } from '../../../../shared/kernel/clock';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../shared/kernel/errors';
import { newId } from '../../../../shared/kernel/ids';
import { Money } from '../../../../shared/kernel/money';
import { Permission } from '../../../../shared/kernel/permissions';
import { normalizePhone } from '../../../../shared/kernel/phone';
import { randomToken } from '../../../../shared/kernel/random';
import { Locale, translate } from '../../../../shared/kernel/translatable';
import { CustomerDirectory } from '../../../customers/public';
import { assertQuantity, DeliveryChannel, resolveDeliveryTarget } from '../../domain/certificate-order';
import { formatTenge } from '../../domain/money-format';
import { CertificateOrder, CertificateOrderRepository, ProductSnapshot } from '../../infrastructure/certificate-order.repository';
import { CertificateProduct, CertificateProductRepository } from '../../infrastructure/certificate-product.repository';
import { CertificateRecord } from '../../infrastructure/certificate.repository';
import { PaymentView } from '../../public';
import { CreatePayment } from '../create-payment.action';
import { PaymentLinks } from '../payment-links';
import { PaymentQueries } from '../payment.queries';
import { RegisterBankTransfer } from '../register-bank-transfer.action';
import { IssueCertificatesForOrder } from './issue-certificates.action';

function snapshotOf(product: CertificateProduct): ProductSnapshot {
  return {
    slug: product.slug,
    kind: product.kind,
    name: product.name,
    description: product.description,
    nominal: product.nominal.toJSON(),
    price: product.price.toJSON(),
    validityMonths: product.validityMonths,
    design: product.design,
  };
}

function optionalPhone(value: string | null | undefined): string | null {
  return value?.trim() ? normalizePhone(value) : null;
}

function describe(product: CertificateProduct, quantity: number, locale: Locale): string {
  const title = translate(product.name, locale) || formatTenge(product.nominal);
  return `AULA: ${title}${quantity > 1 ? ` × ${quantity}` : ''}`;
}

export interface PurchaseCertificateInput {
  productId: string;
  quantity: number;
  buyer: { name: string; phone: string; email?: string | null };
  recipient: { name: string; email?: string | null; phone?: string | null };
  message?: string | null;
  deliveryChannel: Exclude<DeliveryChannel, 'none'>;
  consent: { personalData: boolean; marketing?: boolean };
  locale: Locale;
  idempotencyKey: string;
}

export interface PurchaseResult {
  order: CertificateOrder;
  payment: PaymentView;
}

/**
 * Покупка сертификата на витрине: согласие на обработку ПД (фиксируется в базе гостей с версией
 * текста и IP), заказ сертификатов, онлайн-платёж (purpose gift_certificate). Сертификаты выпускаются
 * по событию успешной оплаты. Идемпотентно по idempotencyKey.
 */
@Injectable()
export class PurchaseCertificate {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly orders: CertificateOrderRepository,
    private readonly createPayment: CreatePayment,
    private readonly paymentQueries: PaymentQueries,
    private readonly customers: CustomerDirectory,
    private readonly links: PaymentLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: PurchaseCertificateInput, context: { ip: string | null }): Promise<PurchaseResult> {
    if (input.consent?.personalData !== true) {
      throw new ValidationError('consent.required', 'Consent to personal data processing is required');
    }
    const existing = await this.orders.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.result(existing);

    const product = await this.products.findById(input.productId);
    if (!product) throw new NotFoundError('certificate_product', input.productId);
    if (!product.isActive) throw new ValidationError('certificate_product.inactive', 'Product is not available for sale');
    if (!product.price.isPositive()) throw new ValidationError('certificate_product.not_for_sale', 'Product has no sale price');
    assertQuantity(input.quantity, 'online');
    const buyerPhone = normalizePhone(input.buyer.phone);
    const recipientPhone = optionalPhone(input.recipient.phone);
    const buyerEmail = input.buyer.email?.trim().toLowerCase() || null;
    const recipientEmail = input.recipient.email?.trim().toLowerCase() || null;
    resolveDeliveryTarget(input.deliveryChannel, { email: recipientEmail, phone: recipientPhone }, { email: buyerEmail, phone: buyerPhone });

    return this.database.transaction(async () => {
      const now = this.clock.now();
      const { customerId } = await this.customers.identify({ phone: buyerPhone, name: input.buyer.name, email: buyerEmail, locale: input.locale });
      const consentVersion = await this.customers.currentConsentVersion('personal_data');
      await this.customers.recordConsent({
        customerId,
        kind: 'personal_data',
        granted: true,
        textVersion: consentVersion,
        source: 'web',
        ip: context.ip,
      });
      if (input.consent.marketing) {
        await this.customers.recordConsent({
          customerId,
          kind: 'marketing',
          granted: true,
          textVersion: await this.customers.currentConsentVersion('marketing'),
          source: 'web',
          ip: context.ip,
        });
      }
      const order: CertificateOrder = {
        id: newId(),
        token: randomToken(24),
        source: 'online',
        productId: product.id,
        product: snapshotOf(product),
        quantity: input.quantity,
        unitPrice: product.price,
        total: product.price.multiply(input.quantity),
        buyer: { name: input.buyer.name.trim(), phone: buyerPhone, email: buyerEmail, company: null },
        recipient: { name: input.recipient.name.trim(), email: recipientEmail, phone: recipientPhone },
        message: input.message?.trim() || null,
        deliveryChannel: input.deliveryChannel,
        locale: input.locale,
        status: 'awaiting_payment',
        paymentId: null,
        idempotencyKey: input.idempotencyKey,
        consentVersion,
        clientIp: context.ip,
        createdBy: null,
        issuedAt: null,
        createdAt: now,
      };
      if (!(await this.orders.insert(order))) {
        return this.result((await this.orders.findByIdempotencyKey(input.idempotencyKey))!);
      }
      const payment = await this.createPayment.execute({
        purpose: 'gift_certificate',
        referenceId: order.id,
        branchId: null,
        method: 'online',
        amount: order.total,
        description: describe(product, input.quantity, input.locale),
        customer: { phone: buyerPhone, name: order.buyer.name, email: buyerEmail },
        returnUrl: this.links.certificateOrderUrl(order.token, input.locale),
        idempotencyKey: `certificate-order:${order.id}`,
      });
      await this.orders.attachPayment(order.id, payment.id);
      await this.audit.record({
        action: 'certificate_order.created',
        entityType: 'certificate_order',
        entityId: order.id,
        after: { status: order.status, total: order.total.toJSON(), quantity: order.quantity, productId: product.id, paymentId: payment.id },
        actor: Actor.guest(),
      });
      return { order: { ...order, paymentId: payment.id }, payment };
    });
  }

  private async result(order: CertificateOrder): Promise<PurchaseResult> {
    if (!order.paymentId) throw new NotFoundError('payment');
    return { order, payment: await this.paymentQueries.get(order.paymentId) };
  }
}

export interface CorporateIssueInput {
  productId: string;
  quantity: number;
  /** Итог по договору (корпоративная скидка); по умолчанию цена × количество. */
  total?: Money | null;
  buyer: { name: string; company?: string | null; phone?: string | null; email?: string | null };
  recipient?: { name: string; email?: string | null; phone?: string | null } | null;
  message?: string | null;
  deliveryChannel: DeliveryChannel;
  locale: Locale;
  documentNumber: string;
  paidAt: Date;
  idempotencyKey: string;
}

/**
 * Корпоративная продажа по счёту: поступление по банковскому переводу регистрируется платежом
 * bank_transfer, сертификаты выпускаются сразу (PDF — рассылка покупателю или скачивание в админке).
 */
@Injectable()
export class IssueCorporateCertificates {
  constructor(
    private readonly products: CertificateProductRepository,
    private readonly orders: CertificateOrderRepository,
    private readonly bankTransfer: RegisterBankTransfer,
    private readonly issue: IssueCertificatesForOrder,
    private readonly paymentQueries: PaymentQueries,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: CorporateIssueInput): Promise<PurchaseResult & { certificates: CertificateRecord[] }> {
    if (!actor.can(Permission.PaymentsManual) && !actor.can(Permission.CertificatesManage)) {
      throw new ForbiddenError('access.forbidden', 'Permission payments.manual or certificates.manage required');
    }
    const existing = await this.orders.findByIdempotencyKey(input.idempotencyKey);
    if (existing) {
      return {
        order: existing,
        payment: await this.paymentQueries.get(existing.paymentId!),
        certificates: await this.issue.execute(existing.id, existing.paymentId),
      };
    }
    const product = await this.products.findById(input.productId);
    if (!product) throw new NotFoundError('certificate_product', input.productId);
    assertQuantity(input.quantity, 'manual');
    const total = input.total ?? product.price.multiply(input.quantity);
    if (!total.isPositive()) throw new ValidationError('certificate_order.total_invalid', 'Total must be positive');
    const buyerPhone = optionalPhone(input.buyer.phone);
    const buyerEmail = input.buyer.email?.trim().toLowerCase() || null;
    const recipient = input.recipient ?? { name: input.buyer.company?.trim() || input.buyer.name, email: buyerEmail, phone: buyerPhone };
    const recipientPhone = optionalPhone(recipient.phone);
    const recipientEmail = recipient.email?.trim().toLowerCase() || null;
    resolveDeliveryTarget(input.deliveryChannel, { email: recipientEmail, phone: recipientPhone }, { email: buyerEmail, phone: buyerPhone });

    return this.database.transaction(async () => {
      const now = this.clock.now();
      const order: CertificateOrder = {
        id: newId(),
        token: randomToken(24),
        source: 'manual',
        productId: product.id,
        product: snapshotOf(product),
        quantity: input.quantity,
        unitPrice: product.price,
        total,
        buyer: { name: input.buyer.name.trim(), phone: buyerPhone, email: buyerEmail, company: input.buyer.company?.trim() || null },
        recipient: { name: recipient.name.trim(), email: recipientEmail, phone: recipientPhone },
        message: input.message?.trim() || null,
        deliveryChannel: input.deliveryChannel,
        locale: input.locale,
        status: 'awaiting_payment',
        paymentId: null,
        idempotencyKey: input.idempotencyKey,
        consentVersion: null,
        clientIp: null,
        createdBy: actor.userId,
        issuedAt: null,
        createdAt: now,
      };
      await this.orders.insert(order);
      const payment = await this.bankTransfer.execute({
        purpose: 'gift_certificate',
        referenceId: order.id,
        branchId: null,
        amount: total,
        paidAt: input.paidAt,
        documentNumber: input.documentNumber,
        idempotencyKey: `certificate-order:${order.id}`,
      });
      await this.orders.attachPayment(order.id, payment.id);
      await this.audit.record({
        action: 'certificate_order.manual_issue',
        entityType: 'certificate_order',
        entityId: order.id,
        after: {
          total: total.toJSON(),
          quantity: input.quantity,
          productId: product.id,
          paymentId: payment.id,
          documentNumber: input.documentNumber,
          buyer: order.buyer,
        },
        actor,
      });
      const certificates = await this.issue.execute(order.id, payment.id);
      return { order: (await this.orders.findById(order.id))!, payment, certificates };
    });
  }
}
