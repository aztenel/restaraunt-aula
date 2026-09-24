import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Money } from '../../../shared/kernel/money';
import { Locale, Translatable } from '../../../shared/kernel/translatable';
import { CertificateOrderFsm, CertificateOrderStatus, DeliveryChannel } from '../domain/certificate-order';
import { CertificateKind } from '../public';
import { CertificateDesign } from './certificate-product.repository';
import { moneyOf } from './payment.repository';
import { CertificateOrdersTable, PaymentsTables } from './payments.tables';

/** Снимок продукта на момент заказа: изменение продукта не меняет прошлые заказы. */
export interface ProductSnapshot {
  slug: string;
  kind: CertificateKind;
  name: Translatable;
  description: Translatable;
  nominal: { amount: number; currency: string };
  price: { amount: number; currency: string };
  validityMonths: number;
  design: CertificateDesign;
}

export interface CertificateOrder {
  id: string;
  token: string;
  source: 'online' | 'manual';
  productId: string;
  product: ProductSnapshot;
  quantity: number;
  unitPrice: Money;
  total: Money;
  buyer: { name: string; phone: string | null; email: string | null; company: string | null };
  recipient: { name: string; email: string | null; phone: string | null };
  message: string | null;
  deliveryChannel: DeliveryChannel;
  locale: Locale;
  status: CertificateOrderStatus;
  paymentId: string | null;
  idempotencyKey: string;
  consentVersion: string | null;
  clientIp: string | null;
  createdBy: string | null;
  issuedAt: Date | null;
  createdAt: Date;
}

function mapOrder(row: Selectable<CertificateOrdersTable>): CertificateOrder {
  return {
    id: row.id,
    token: row.token,
    source: row.source as CertificateOrder['source'],
    productId: row.product_id,
    product: row.product_snapshot as ProductSnapshot,
    quantity: row.quantity,
    unitPrice: moneyOf(row.unit_price_amount, row.unit_price_currency),
    total: moneyOf(row.total_amount, row.total_currency),
    buyer: { name: row.buyer_name, phone: row.buyer_phone, email: row.buyer_email, company: row.buyer_company },
    recipient: { name: row.recipient_name, email: row.recipient_email, phone: row.recipient_phone },
    message: row.message,
    deliveryChannel: row.delivery_channel as DeliveryChannel,
    locale: row.locale as Locale,
    status: row.status as CertificateOrderStatus,
    paymentId: row.payment_id,
    idempotencyKey: row.idempotency_key,
    consentVersion: row.consent_version,
    clientIp: row.client_ip,
    createdBy: row.created_by,
    issuedAt: row.issued_at,
    createdAt: row.created_at,
  };
}

@Injectable()
export class CertificateOrderRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<CertificateOrder | null> {
    let q = this.db().selectFrom('payments.certificate_orders').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapOrder(row) : null;
  }

  async findByToken(token: string): Promise<CertificateOrder | null> {
    const row = await this.db().selectFrom('payments.certificate_orders').selectAll().where('token', '=', token).executeTakeFirst();
    return row ? mapOrder(row) : null;
  }

  async findByIdempotencyKey(key: string): Promise<CertificateOrder | null> {
    const row = await this.db().selectFrom('payments.certificate_orders').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
    return row ? mapOrder(row) : null;
  }

  /** false — заказ с таким ключом идемпотентности уже есть (гонка двух одинаковых запросов). */
  async insert(order: CertificateOrder): Promise<boolean> {
    const row = await this.db()
      .insertInto('payments.certificate_orders')
      .values({
        id: order.id,
        token: order.token,
        source: order.source,
        product_id: order.productId,
        product_snapshot: JSON.stringify(order.product),
        quantity: order.quantity,
        unit_price_amount: order.unitPrice.amount,
        unit_price_currency: order.unitPrice.currency,
        total_amount: order.total.amount,
        total_currency: order.total.currency,
        buyer_name: order.buyer.name,
        buyer_phone: order.buyer.phone,
        buyer_email: order.buyer.email,
        buyer_company: order.buyer.company,
        recipient_name: order.recipient.name,
        recipient_email: order.recipient.email,
        recipient_phone: order.recipient.phone,
        message: order.message,
        delivery_channel: order.deliveryChannel,
        locale: order.locale,
        status: order.status,
        payment_id: order.paymentId,
        idempotency_key: order.idempotencyKey,
        consent_version: order.consentVersion,
        client_ip: order.clientIp,
        created_by: order.createdBy,
        issued_at: order.issuedAt,
        created_at: order.createdAt,
      })
      .onConflict((oc) => oc.column('idempotency_key').doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  async attachPayment(id: string, paymentId: string): Promise<void> {
    await this.db().updateTable('payments.certificate_orders').set({ payment_id: paymentId }).where('id', '=', id).execute();
  }

  /** Переход статуса только по автомату заказа. */
  async transition(order: CertificateOrder, to: CertificateOrderStatus, now: Date): Promise<CertificateOrder> {
    CertificateOrderFsm.assertTransition(order.status, to);
    await this.db()
      .updateTable('payments.certificate_orders')
      .set({ status: to, issued_at: to === 'issued' ? now : order.issuedAt })
      .where('id', '=', order.id)
      .execute();
    return { ...order, status: to, issuedAt: to === 'issued' ? now : order.issuedAt };
  }
}
