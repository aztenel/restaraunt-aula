import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../../shared/infrastructure/database/database';
import { EventBus } from '../../../../shared/infrastructure/events/event-bus';
import { PdfRenderer } from '../../../../shared/infrastructure/pdf/pdf-renderer';
import { FileStorage } from '../../../../shared/infrastructure/storage/file-storage';
import { Clock } from '../../../../shared/kernel/clock';
import { InvariantViolationError } from '../../../../shared/kernel/errors';
import { newId } from '../../../../shared/kernel/ids';
import { Money } from '../../../../shared/kernel/money';
import { BranchDirectory, LegalEntityDirectory } from '../../../identity/public';
import { certificateCodeLast4, generateCertificateCode, normalizeCertificateCode } from '../../domain/certificate-code';
import { splitEvenly } from '../../domain/certificate-order';
import { GiftCertificate } from '../../domain/gift-certificate';
import { CertificateOrder, CertificateOrderRepository } from '../../infrastructure/certificate-order.repository';
import { CertificateRecord, CertificateRepository } from '../../infrastructure/certificate.repository';
import { CertificateIssuedPayload, PaymentsEvents } from '../../public';
import { certificateDocument } from './certificate-document';
import { certificateAuditState } from './certificate-views';
import { DeliverCertificate } from './deliver-certificate.action';
import { CertificateCodeHasher } from './find-certificate-by-code.action';

const MAX_CODE_ATTEMPTS = 5;

/**
 * Выпуск сертификатов по оплаченному заказу (своё событие PaymentSucceeded с purpose=gift_certificate
 * или корпоративная продажа). Для каждого сертификата: код (в БД — только HMAC и последние 4 символа),
 * движение «выпуск», PDF с кодом и QR в приватном хранилище, доставка гостю, событие CertificateIssued
 * (цена = цена продажи). Полный код существует только в PDF и сообщении.
 *
 * Идемпотентно: заказ в статусе issued повторно не выпускается. При ошибке транзакция откатывается
 * целиком, и повторная доставка события выпускает сертификаты заново (с новыми кодами).
 */
@Injectable()
export class IssueCertificatesForOrder {
  private readonly logger = new Logger(IssueCertificatesForOrder.name);

  constructor(
    private readonly orders: CertificateOrderRepository,
    private readonly certificates: CertificateRepository,
    private readonly hasher: CertificateCodeHasher,
    private readonly deliver: DeliverCertificate,
    private readonly pdf: PdfRenderer,
    private readonly storage: FileStorage,
    private readonly legalEntities: LegalEntityDirectory,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string, paymentId: string | null): Promise<CertificateRecord[]> {
    return this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      if (!order) {
        this.logger.warn({ orderId, paymentId }, 'Certificate order not found for a gift_certificate payment');
        return [];
      }
      if (order.status === 'issued') return this.certificates.listByOrder(order.id);
      const now = this.clock.now();
      const prices = splitEvenly(order.total, order.quantity);
      const context = await this.documentContext();
      const issued: CertificateRecord[] = [];
      for (let i = 0; i < order.quantity; i++) {
        issued.push(await this.issueOne(order, prices[i]!, paymentId, now, context));
      }
      await this.orders.transition(order, 'issued', now);
      await this.audit.record({
        action: 'certificate_order.issued',
        entityType: 'certificate_order',
        entityId: order.id,
        before: { status: order.status },
        after: { status: 'issued', certificates: issued.map((r) => r.certificate.id) },
        meta: { paymentId, total: order.total.toJSON(), quantity: order.quantity },
      });
      return issued;
    });
  }

  private async documentContext() {
    const seller = await this.legalEntities.forBranch(null).catch(() => null);
    const branches = await this.branches.list({ activeOnly: true });
    return {
      seller: seller ? { name: seller.name, bin: seller.bin } : null,
      branches: branches.map((b) => ({ name: b.name, address: b.address })),
    };
  }

  private async issueOne(
    order: CertificateOrder,
    price: Money,
    paymentId: string | null,
    now: Date,
    context: Awaited<ReturnType<IssueCertificatesForOrder['documentContext']>>,
  ): Promise<CertificateRecord> {
    const product = order.product;
    const nominal = Money.of(product.nominal.amount, product.nominal.currency as Money['currency']);
    let code = '';
    let record: CertificateRecord | null = null;
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !record; attempt++) {
      code = generateCertificateCode();
      const normalized = normalizeCertificateCode(code)!;
      const candidate: CertificateRecord = {
        certificate: GiftCertificate.issue(
          {
            id: newId(),
            orderId: order.id,
            productId: order.productId,
            kind: product.kind,
            name: product.name,
            setDescription: product.kind === 'set' ? product.description : null,
            nominal,
            price,
            last4: certificateCodeLast4(normalized),
            validityMonths: product.validityMonths,
          },
          now,
        ),
        codeHash: this.hasher.hash(normalized),
        buyerName: order.buyer.name,
        buyerPhone: order.buyer.phone,
        buyerEmail: order.buyer.email,
        recipientName: order.recipient.name,
        recipientEmail: order.recipient.email,
        recipientPhone: order.recipient.phone,
        message: order.message,
        deliveryChannel: order.deliveryChannel,
        locale: order.locale,
        pdfFileKey: null,
        deliveryCount: 0,
        lastDeliveredAt: null,
        createdAt: now,
      };
      if (await this.certificates.insert(candidate)) record = candidate;
    }
    if (!record) throw new InvariantViolationError('certificate.code_collision', 'Could not generate a unique certificate code');
    const s = record.certificate.snapshot();

    await this.certificates.addLedger({
      certificateId: s.id,
      kind: 'issue',
      amount: s.nominal,
      balanceAfter: s.balance,
      channel: 'sale',
      paymentId,
      refundId: null,
      referenceType: 'certificate_order',
      referenceId: order.id,
      branchId: null,
      actorUserId: null,
      actorName: 'system',
      comment: null,
      occurredAt: now,
    });

    const pdf = await this.pdf.render(
      certificateDocument({
        code,
        kind: s.kind,
        name: s.name,
        setDescription: s.setDescription,
        nominal: s.nominal,
        expiresAt: s.expiresAt,
        recipientName: order.recipient.name,
        message: order.message,
        locale: order.locale,
        color: product.design?.color ?? '#7a4b2a',
        seller: context.seller,
        branches: context.branches,
      }),
    );
    const fileKey = `certificates/${s.id}.pdf`;
    await this.storage.put({ key: fileKey, body: pdf, contentType: 'application/pdf', visibility: 'private' });
    await this.certificates.setPdf(s.id, fileKey);
    record.pdfFileKey = fileKey;

    await this.deliver.execute({ record, code, dedupeKey: `certificate:${s.id}:issued` });
    await this.audit.record({
      action: 'certificate.issued',
      entityType: 'gift_certificate',
      entityId: s.id,
      after: certificateAuditState(record),
      meta: { orderId: order.id, paymentId, price: price.toJSON() },
    });
    await this.events.publish(
      PaymentsEvents.CertificateIssued,
      {
        certificateId: s.id,
        productId: order.productId,
        kind: s.kind,
        nominal: s.nominal.toJSON(),
        price: price.toJSON(),
        buyerPhone: order.buyer.phone,
        branchId: null,
        occurredAt: now.toISOString(),
      } satisfies CertificateIssuedPayload,
      { aggregateId: s.id },
    );
    return record;
  }
}
