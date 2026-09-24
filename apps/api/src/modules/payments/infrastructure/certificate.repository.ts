import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Locale, Translatable } from '../../../shared/kernel/translatable';
import { DeliveryChannel } from '../domain/certificate-order';
import { GiftCertificate, GiftCertificateProps } from '../domain/gift-certificate';
import { CertificateKind, CertificateStatus } from '../public';
import { moneyOf } from './payment.repository';
import { CertificateTransactionsTable, GiftCertificatesTable, PaymentsTables } from './payments.tables';

export interface CertificateContacts {
  buyerName: string | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  recipientPhone: string | null;
  message: string | null;
  deliveryChannel: DeliveryChannel;
  locale: Locale;
}

export interface CertificateRecord extends CertificateContacts {
  certificate: GiftCertificate;
  codeHash: string;
  pdfFileKey: string | null;
  deliveryCount: number;
  lastDeliveredAt: Date | null;
  createdAt: Date;
}

export type LedgerKind = 'issue' | 'debit' | 'credit' | 'expire' | 'reinstate';
export type LedgerChannel = 'order' | 'point' | 'refund' | 'sale' | 'system' | 'admin';

export interface LedgerEntry {
  id: string;
  certificateId: string;
  kind: LedgerKind;
  amount: Money;
  balanceAfter: Money;
  channel: LedgerChannel;
  paymentId: string | null;
  refundId: string | null;
  referenceType: string | null;
  referenceId: string | null;
  branchId: string | null;
  actorUserId: string | null;
  actorName: string;
  comment: string | null;
  occurredAt: Date;
}

export interface CertificateSearchFilter {
  last4?: string;
  buyerPhone?: string;
  status?: CertificateStatus;
  orderId?: string;
}

function mapCertificate(row: Selectable<GiftCertificatesTable>): CertificateRecord {
  const props: GiftCertificateProps = {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id,
    kind: row.kind as CertificateKind,
    name: (row.name as Translatable) ?? {},
    setDescription: (row.set_description as Translatable | null) ?? null,
    nominal: moneyOf(row.nominal_amount, row.nominal_currency),
    balance: moneyOf(row.balance_amount, row.balance_currency),
    price: moneyOf(row.price_amount, row.price_currency),
    status: row.status as CertificateStatus,
    statusReason: row.status_reason,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    last4: row.last4.trim(),
  };
  return {
    certificate: GiftCertificate.restore(props),
    codeHash: row.code_hash,
    buyerName: row.buyer_name,
    buyerPhone: row.buyer_phone,
    buyerEmail: row.buyer_email,
    recipientName: row.recipient_name,
    recipientEmail: row.recipient_email,
    recipientPhone: row.recipient_phone,
    message: row.message,
    deliveryChannel: row.delivery_channel as DeliveryChannel,
    locale: row.locale as Locale,
    pdfFileKey: row.pdf_file_key,
    deliveryCount: row.delivery_count,
    lastDeliveredAt: row.last_delivered_at,
    createdAt: row.created_at,
  };
}

function mapLedger(row: Selectable<CertificateTransactionsTable>): LedgerEntry {
  return {
    id: row.id,
    certificateId: row.certificate_id,
    kind: row.kind as LedgerKind,
    amount: moneyOf(row.change_amount, row.change_currency),
    balanceAfter: moneyOf(row.balance_after_amount, row.balance_after_currency),
    channel: row.channel as LedgerChannel,
    paymentId: row.payment_id,
    refundId: row.refund_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    branchId: row.branch_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    comment: row.comment,
    occurredAt: row.occurred_at,
  };
}

export interface CertificateReportTotals {
  issued: { count: number; nominal: number; price: number };
  redeemed: { operations: number; certificates: number; amount: number };
  returned: { operations: number; amount: number };
  expired: { count: number; amount: number };
  reinstated: { count: number; amount: number };
  liability: { active: { count: number; amount: number }; blocked: { count: number; amount: number } };
}

@Injectable()
export class CertificateRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<PaymentsTables>();
  }

  /** false — коллизия хэша кода (код уже существует): вызывающий генерирует новый код. */
  async insert(record: CertificateRecord): Promise<boolean> {
    const s = record.certificate.snapshot();
    const row = await this.db()
      .insertInto('payments.gift_certificates')
      .values({
        id: s.id,
        code_hash: record.codeHash,
        last4: s.last4,
        order_id: s.orderId,
        product_id: s.productId,
        kind: s.kind,
        name: JSON.stringify(s.name),
        set_description: s.setDescription ? JSON.stringify(s.setDescription) : null,
        nominal_amount: s.nominal.amount,
        nominal_currency: s.nominal.currency,
        balance_amount: s.balance.amount,
        balance_currency: s.balance.currency,
        price_amount: s.price.amount,
        price_currency: s.price.currency,
        status: s.status,
        status_reason: s.statusReason,
        issued_at: s.issuedAt,
        expires_at: s.expiresAt,
        buyer_name: record.buyerName,
        buyer_phone: record.buyerPhone,
        buyer_email: record.buyerEmail,
        recipient_name: record.recipientName,
        recipient_email: record.recipientEmail,
        recipient_phone: record.recipientPhone,
        message: record.message,
        delivery_channel: record.deliveryChannel,
        locale: record.locale,
        pdf_file_key: record.pdfFileKey,
        delivery_count: record.deliveryCount,
        last_delivered_at: record.lastDeliveredAt,
      })
      .onConflict((oc) => oc.column('code_hash').doNothing())
      .returning('id')
      .executeTakeFirst();
    return !!row;
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<CertificateRecord | null> {
    let q = this.db().selectFrom('payments.gift_certificates').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapCertificate(row) : null;
  }

  /** Поиск по хэшу кода; forUpdate — блокировка строки на время списания. */
  async findByCodeHash(codeHash: string, options: { forUpdate?: boolean } = {}): Promise<CertificateRecord | null> {
    let q = this.db().selectFrom('payments.gift_certificates').selectAll().where('code_hash', '=', codeHash);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapCertificate(row) : null;
  }

  async listByOrder(orderId: string): Promise<CertificateRecord[]> {
    const rows = await this.db()
      .selectFrom('payments.gift_certificates')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('issued_at')
      .orderBy('id')
      .execute();
    return rows.map(mapCertificate);
  }

  /** Сохранить изменяемое состояние сертификата (статус, остаток, срок). */
  async save(certificate: GiftCertificate): Promise<void> {
    const s = certificate.snapshot();
    await this.db()
      .updateTable('payments.gift_certificates')
      .set({
        status: s.status,
        status_reason: s.statusReason,
        balance_amount: s.balance.amount,
        balance_currency: s.balance.currency,
        expires_at: s.expiresAt,
      })
      .where('id', '=', s.id)
      .execute();
  }

  async setPdf(id: string, fileKey: string): Promise<void> {
    await this.db().updateTable('payments.gift_certificates').set({ pdf_file_key: fileKey }).where('id', '=', id).execute();
  }

  async markDelivered(id: string, now: Date): Promise<void> {
    await this.db()
      .updateTable('payments.gift_certificates')
      .set({ delivery_count: sql`delivery_count + 1`, last_delivered_at: now })
      .where('id', '=', id)
      .execute();
  }

  async addLedger(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry> {
    const id = newId();
    await this.db()
      .insertInto('payments.certificate_transactions')
      .values({
        id,
        certificate_id: entry.certificateId,
        kind: entry.kind,
        change_amount: entry.amount.amount,
        change_currency: entry.amount.currency,
        balance_after_amount: entry.balanceAfter.amount,
        balance_after_currency: entry.balanceAfter.currency,
        channel: entry.channel,
        payment_id: entry.paymentId,
        refund_id: entry.refundId,
        reference_type: entry.referenceType,
        reference_id: entry.referenceId,
        branch_id: entry.branchId,
        actor_user_id: entry.actorUserId,
        actor_name: entry.actorName,
        comment: entry.comment,
        occurred_at: entry.occurredAt,
      })
      .execute();
    return { id, ...entry };
  }

  async ledger(certificateId: string): Promise<LedgerEntry[]> {
    const rows = await this.db()
      .selectFrom('payments.certificate_transactions')
      .selectAll()
      .where('certificate_id', '=', certificateId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map(mapLedger);
  }

  async search(filter: CertificateSearchFilter, page: PageRequest): Promise<Page<CertificateRecord>> {
    let q = this.db().selectFrom('payments.gift_certificates');
    if (filter.last4) q = q.where('last4', '=', filter.last4);
    if (filter.buyerPhone) {
      const phone = filter.buyerPhone;
      q = q.where((eb) => eb.or([eb('buyer_phone', '=', phone), eb('recipient_phone', '=', phone)]));
    }
    if (filter.status) q = q.where('status', '=', filter.status);
    if (filter.orderId) q = q.where('order_id', '=', filter.orderId);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('issued_at', 'desc').orderBy('id', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(rows.map(mapCertificate), Number(total?.n ?? 0), page);
  }

  /** Активные сертификаты с истёкшим сроком (для ежедневной задачи). */
  async findExpiredActiveIds(now: Date, limit: number): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('payments.gift_certificates')
      .select('id')
      .where('status', '=', 'active')
      .where('expires_at', '<=', now)
      .orderBy('expires_at')
      .limit(limit)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Отчёт: выпущено, погашено, возвращено, просрочено за период + остаток обязательств на сейчас. */
  async report(from: Date, to: Date): Promise<CertificateReportTotals> {
    const issued = await this.db()
      .selectFrom('payments.gift_certificates')
      .where('issued_at', '>=', from)
      .where('issued_at', '<', to)
      .select((eb) => [
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>('nominal_amount'), sql<number>`0`).as('nominal'),
        eb.fn.coalesce(eb.fn.sum<number>('price_amount'), sql<number>`0`).as('price'),
      ])
      .executeTakeFirst();
    const moves = await this.db()
      .selectFrom('payments.certificate_transactions')
      .where('occurred_at', '>=', from)
      .where('occurred_at', '<', to)
      .select((eb) => [
        'kind',
        eb.fn.countAll<number>().as('operations'),
        sql<number>`count(distinct certificate_id)`.as('certificates'),
        eb.fn.coalesce(eb.fn.sum<number>('change_amount'), sql<number>`0`).as('amount'),
      ])
      .groupBy('kind')
      .execute();
    const liability = await this.db()
      .selectFrom('payments.gift_certificates')
      .where('status', 'in', ['active', 'blocked'])
      .select((eb) => [
        'status',
        eb.fn.countAll<number>().as('count'),
        eb.fn.coalesce(eb.fn.sum<number>('balance_amount'), sql<number>`0`).as('amount'),
      ])
      .groupBy('status')
      .execute();
    const move = (kind: LedgerKind) => moves.find((m) => m.kind === kind);
    const liab = (status: string) => liability.find((l) => l.status === status);
    return {
      issued: { count: Number(issued?.count ?? 0), nominal: Number(issued?.nominal ?? 0), price: Number(issued?.price ?? 0) },
      redeemed: {
        operations: Number(move('debit')?.operations ?? 0),
        certificates: Number(move('debit')?.certificates ?? 0),
        amount: Number(move('debit')?.amount ?? 0),
      },
      returned: { operations: Number(move('credit')?.operations ?? 0), amount: Number(move('credit')?.amount ?? 0) },
      expired: { count: Number(move('expire')?.operations ?? 0), amount: Number(move('expire')?.amount ?? 0) },
      reinstated: { count: Number(move('reinstate')?.operations ?? 0), amount: Number(move('reinstate')?.amount ?? 0) },
      liability: {
        active: { count: Number(liab('active')?.count ?? 0), amount: Number(liab('active')?.amount ?? 0) },
        blocked: { count: Number(liab('blocked')?.count ?? 0), amount: Number(liab('blocked')?.amount ?? 0) },
      },
    };
  }
}
