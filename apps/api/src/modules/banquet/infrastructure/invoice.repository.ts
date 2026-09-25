import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { ConflictError } from '../../../shared/kernel/errors';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { BanquetInvoice, InvoicePurpose, InvoiceStatus, PayerType } from '../domain/invoice';
import { BuyerSnapshot, SellerSnapshot } from '../domain/requisites';
import { BanquetTables, InvoicePaymentsTable, InvoicesTable } from './banquet.tables';

export interface InvoiceRecord {
  id: string;
  requestId: string;
  number: string;
  branchId: string | null;
  payerType: PayerType;
  companyId: string | null;
  buyer: BuyerSnapshot;
  seller: SellerSnapshot;
  purpose: InvoicePurpose;
  description: string;
  amount: Money;
  vat: Money;
  vatRateBp: number;
  paid: Money;
  refunded: Money;
  dueDate: string;
  status: InvoiceStatus;
  /** Онлайн-платёж (счёт физлицу). */
  paymentId: string | null;
  publicToken: string;
  pdfFileKey: string | null;
  issuedAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdBy: string | null;
  createdByName: string;
}

export interface InvoicePaymentRecord {
  id: string;
  invoiceId: string;
  paymentId: string;
  method: string;
  amount: Money;
  refunded: Money;
  documentNumber: string | null;
  paidAt: Date;
  recordedAt: Date;
  recordedBy: string | null;
  recordedByName: string;
}

export function invoiceEntity(r: InvoiceRecord): BanquetInvoice {
  return new BanquetInvoice({
    id: r.id,
    amount: r.amount,
    paid: r.paid,
    refunded: r.refunded,
    status: r.status,
    dueDate: r.dueDate,
    paidAt: r.paidAt,
    cancelledAt: r.cancelledAt,
  });
}

function m(amount: number, currency: string): Money {
  return Money.of(amount, currency as Currency);
}

function mapInvoice(r: Selectable<InvoicesTable>): InvoiceRecord {
  return {
    id: r.id,
    requestId: r.request_id,
    number: r.number,
    branchId: r.branch_id,
    payerType: r.payer_type as PayerType,
    companyId: r.company_id,
    buyer: r.buyer as BuyerSnapshot,
    seller: r.seller as SellerSnapshot,
    purpose: r.purpose as InvoicePurpose,
    description: r.description,
    amount: m(r.amount_amount, r.amount_currency),
    vat: m(r.vat_amount, r.vat_currency),
    vatRateBp: r.vat_rate_bp,
    paid: m(r.paid_amount, r.paid_currency),
    refunded: m(r.refunded_amount, r.refunded_currency),
    dueDate: r.due_date,
    status: r.status as InvoiceStatus,
    paymentId: r.payment_id,
    publicToken: r.public_token,
    pdfFileKey: r.pdf_file_key,
    issuedAt: r.issued_at,
    paidAt: r.paid_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
  };
}

function mapPayment(r: Selectable<InvoicePaymentsTable>): InvoicePaymentRecord {
  return {
    id: r.id,
    invoiceId: r.invoice_id,
    paymentId: r.payment_id,
    method: r.method,
    amount: m(r.amount_amount, r.amount_currency),
    refunded: m(r.refunded_amount, r.refunded_currency),
    documentNumber: r.document_number,
    paidAt: r.paid_at,
    recordedAt: r.recorded_at,
    recordedBy: r.recorded_by,
    recordedByName: r.recorded_by_name,
  };
}

/** Нарушение CHECK/триггера инварианта оплат — это переплата (вторая линия защиты). */
function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}

export interface InvoiceFilter {
  branches: 'all' | string[];
  statuses?: InvoiceStatus[];
  overdueOn?: string;
  requestId?: string;
}

@Injectable()
export class InvoiceRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async insert(r: InvoiceRecord): Promise<void> {
    await this.db()
      .insertInto('banquet.invoices')
      .values({
        id: r.id,
        request_id: r.requestId,
        number: r.number,
        branch_id: r.branchId,
        payer_type: r.payerType,
        company_id: r.companyId,
        buyer: JSON.stringify(r.buyer),
        seller: JSON.stringify(r.seller),
        purpose: r.purpose,
        description: r.description,
        amount_amount: r.amount.amount,
        amount_currency: r.amount.currency,
        vat_amount: r.vat.amount,
        vat_currency: r.vat.currency,
        vat_rate_bp: r.vatRateBp,
        paid_amount: r.paid.amount,
        paid_currency: r.paid.currency,
        refunded_amount: r.refunded.amount,
        refunded_currency: r.refunded.currency,
        due_date: r.dueDate,
        status: r.status,
        payment_id: r.paymentId,
        public_token: r.publicToken,
        pdf_file_key: r.pdfFileKey,
        issued_at: r.issuedAt,
        paid_at: r.paidAt,
        cancelled_at: r.cancelledAt,
        cancel_reason: r.cancelReason,
        created_by: r.createdBy,
        created_by_name: r.createdByName,
      })
      .execute();
  }

  /** Сохранить состояние оплаты/отмены из доменного объекта. */
  async saveState(invoice: BanquetInvoice, extra: { cancelReason?: string | null } = {}): Promise<void> {
    const s = invoice.snapshot();
    try {
      await this.db()
        .updateTable('banquet.invoices')
        .set({
          paid_amount: s.paid.amount,
          refunded_amount: s.refunded.amount,
          status: s.status,
          paid_at: s.paidAt,
          cancelled_at: s.cancelledAt,
          ...(extra.cancelReason !== undefined ? { cancel_reason: extra.cancelReason } : {}),
        })
        .where('id', '=', s.id)
        .execute();
    } catch (err) {
      if (isCheckViolation(err)) throw new ConflictError('banquet_invoice.overpayment', 'Payments cannot exceed the invoice amount');
      throw err;
    }
  }

  async setPaymentId(id: string, paymentId: string): Promise<void> {
    await this.db().updateTable('banquet.invoices').set({ payment_id: paymentId }).where('id', '=', id).execute();
  }

  async setPdf(id: string, fileKey: string): Promise<void> {
    await this.db().updateTable('banquet.invoices').set({ pdf_file_key: fileKey }).where('id', '=', id).execute();
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<InvoiceRecord | null> {
    let q = this.db().selectFrom('banquet.invoices').selectAll().where('id', '=', id);
    if (options.forUpdate) q = q.forUpdate();
    const row = await q.executeTakeFirst();
    return row ? mapInvoice(row) : null;
  }

  async findByToken(token: string): Promise<InvoiceRecord | null> {
    const row = await this.db().selectFrom('banquet.invoices').selectAll().where('public_token', '=', token).executeTakeFirst();
    return row ? mapInvoice(row) : null;
  }

  async listForRequest(requestId: string): Promise<InvoiceRecord[]> {
    const rows = await this.db()
      .selectFrom('banquet.invoices')
      .selectAll()
      .where('request_id', '=', requestId)
      .orderBy('issued_at')
      .orderBy('id')
      .execute();
    return rows.map(mapInvoice);
  }

  async list(filter: InvoiceFilter, page: PageRequest): Promise<{ items: InvoiceRecord[]; total: number }> {
    let q = this.db().selectFrom('banquet.invoices');
    if (filter.branches !== 'all') {
      q = filter.branches.length === 0 ? q.where(sql<boolean>`false`) : q.where('branch_id', 'in', filter.branches);
    }
    if (filter.statuses?.length) q = q.where('status', 'in', filter.statuses);
    if (filter.requestId) q = q.where('request_id', '=', filter.requestId);
    if (filter.overdueOn) q = q.where('status', 'in', ['issued', 'partially_paid']).where('due_date', '<', filter.overdueOn);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('issued_at', 'desc').orderBy('id', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return { items: rows.map(mapInvoice), total: Number(total?.n ?? 0) };
  }

  async insertPayment(p: InvoicePaymentRecord): Promise<boolean> {
    try {
      const row = await this.db()
        .insertInto('banquet.invoice_payments')
        .values({
          id: p.id,
          invoice_id: p.invoiceId,
          payment_id: p.paymentId,
          method: p.method,
          amount_amount: p.amount.amount,
          amount_currency: p.amount.currency,
          refunded_amount: p.refunded.amount,
          refunded_currency: p.refunded.currency,
          document_number: p.documentNumber,
          paid_at: p.paidAt,
          recorded_at: p.recordedAt,
          recorded_by: p.recordedBy,
          recorded_by_name: p.recordedByName,
        })
        .onConflict((oc) => oc.column('payment_id').doNothing())
        .returning('id')
        .executeTakeFirst();
      return !!row;
    } catch (err) {
      if (isCheckViolation(err)) throw new ConflictError('banquet_invoice.overpayment', 'Payments cannot exceed the invoice amount');
      throw err;
    }
  }

  async findPayment(paymentId: string): Promise<InvoicePaymentRecord | null> {
    const row = await this.db().selectFrom('banquet.invoice_payments').selectAll().where('payment_id', '=', paymentId).executeTakeFirst();
    return row ? mapPayment(row) : null;
  }

  async paymentsOf(invoiceIds: string[]): Promise<InvoicePaymentRecord[]> {
    if (invoiceIds.length === 0) return [];
    const rows = await this.db()
      .selectFrom('banquet.invoice_payments')
      .selectAll()
      .where('invoice_id', 'in', invoiceIds)
      .orderBy('paid_at')
      .orderBy('id')
      .execute();
    return rows.map(mapPayment);
  }

  async addPaymentRefund(paymentId: string, amount: Money): Promise<void> {
    await this.db()
      .updateTable('banquet.invoice_payments')
      .set((eb) => ({ refunded_amount: sql<number>`least(${eb.ref('amount_amount')}, ${eb.ref('refunded_amount')} + ${amount.amount})` }))
      .where('payment_id', '=', paymentId)
      .execute();
  }
}
