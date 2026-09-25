import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { randomToken } from '../../../shared/kernel/random';
import { isIsoDate } from '../../../shared/kernel/time';
import { CustomerDirectory, CustomerTag } from '../../customers/public';
import { Notifier } from '../../notifications/public';
import { PaymentPurpose, PaymentsService, RefundView } from '../../payments/public';
import { INVOICEABLE_STATUSES } from '../domain/banquet-status';
import { BanquetRequest } from '../domain/banquet-request';
import { formatDateRu } from '../domain/dates';
import { assertWithinQuote, defaultDueDate, defaultInvoiceAmount, InvoicePurpose, PayerType } from '../domain/invoice';
import { formatTenge } from '../domain/money-format';
import { buyerFromCompany, buyerFromContact } from '../domain/requisites';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { CompanyRepository } from '../infrastructure/company.repository';
import { invoiceEntity, InvoiceRecord, InvoiceRepository } from '../infrastructure/invoice.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { BanquetEvents, BanquetInvoiceIssuedPayload, BanquetInvoicePaymentPayload } from '../public';
import { assertCanInvoice } from './access';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';
import { BanquetDocumentFiles } from './document-files';
import { BanquetFunnel } from './funnel';
import { BanquetStatusRecorder } from './status-recorder';

export interface IssueInvoiceInput {
  payerType: PayerType;
  /** Для юрлица: компания-заказчик (по умолчанию — компания заявки). */
  companyId?: string | null;
  /** По умолчанию: остаток предоплаты (до prepaid) или остаток до итога сметы. */
  amount?: Money | null;
  dueDate?: string | null;
  description?: string | null;
}

function invoiceAudit(r: InvoiceRecord): Record<string, unknown> {
  return {
    number: r.number,
    payerType: r.payerType,
    amount: r.amount.toJSON(),
    paid: r.paid.toJSON(),
    refunded: r.refunded.toJSON(),
    status: r.status,
    dueDate: r.dueDate,
  };
}

/** Ключ онлайн-платежа по счёту: referenceId платежа — id счёта (отчётность связывает возвраты со счётом). */
function onlinePaymentKey(invoiceId: string, attempt: number): string {
  return attempt === 0 ? `banquet-invoice:${invoiceId}` : `banquet-invoice:${invoiceId}:${attempt}`;
}

/**
 * Счёт по банкету (IssueBanquetInvoice из ТЗ). Физлицу — онлайн-платёж (purpose banquet_invoice, ссылка на
 * странице счёта), юрлицу — счёт на оплату PDF с реквизитами сторон, номер в разрезе филиала и года.
 * Сумма всех действующих счетов не превышает итог сметы. Событие InvoiceIssued, уведомление гостю,
 * тег corporate гостю при счёте юрлицу.
 */
@Injectable()
export class IssueBanquetInvoice {
  constructor(
    private readonly requests: RequestRepository,
    private readonly invoices: InvoiceRepository,
    private readonly companies: CompanyRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly files: BanquetDocumentFiles,
    private readonly payments: PaymentsService,
    private readonly customers: CustomerDirectory,
    private readonly notifier: Notifier,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}


  async execute(actor: Actor, requestId: string, input: IssueInvoiceInput): Promise<InvoiceRecord> {
    return this.database.transaction(async () => {
      const request = await this.support.load(requestId, { forUpdate: true });
      assertCanInvoice(actor, request);
      if (!INVOICEABLE_STATUSES.includes(request.status)) {
        throw new ConflictError('banquet_invoice.request_not_agreed', 'Invoices are issued after the quote is agreed', { status: request.status });
      }
      const s = request.snapshot();
      const quote = await this.support.currentQuote(requestId);
      if (!quote) throw new ConflictError('banquet_invoice.no_quote', 'Request has no quote');
      const existing = await this.invoices.listForRequest(requestId);
      const invoicedActive = Money.sum(existing.filter((i) => i.status !== 'cancelled').map((i) => i.amount));
      const required = request.requiredPrepayment(quote.totals.total);
      const defaults = defaultInvoiceAmount({ requestStatus: request.status, quoteTotal: quote.totals.total, requiredPrepayment: required, invoicedActive });
      const amount = input.amount ?? defaults.amount;
      const purpose: InvoicePurpose = input.amount ? (request.status === 'agreed' ? 'prepayment' : 'payment') : defaults.purpose;
      assertWithinQuote(amount, { quoteTotal: quote.totals.total, invoicedActive });

      const today = await this.support.today(s.branchId);
      const dueDate = input.dueDate ?? defaultDueDate(today, s.eventDate, input.payerType);
      if (!isIsoDate(dueDate) || dueDate < today) throw new ValidationError('banquet_invoice.invalid_due_date', 'Due date must be today or later');

      let buyer = buyerFromContact(request.contact());
      let companyId: string | null = null;
      if (input.payerType === 'company') {
        companyId = input.companyId ?? s.companyId;
        if (!companyId) throw new ValidationError('banquet_invoice.company_required', 'Company requisites are required for a company invoice');
        const company = await this.companies.findById(companyId);
        if (!company) throw new ValidationError('banquet_company.not_found', 'Company not found', { companyId });
        buyer = buyerFromCompany(companyId, company, request.contact());
        if (!s.companyId) {
          request.setCompany(companyId);
          await this.requests.save(request);
        }
      }
      const seller = await this.support.seller(s.branchId);
      const { number } = await this.support.nextNumber('invoice', s.branchId);
      const now = this.clock.now();
      const description =
        input.description?.trim() ||
        `${purpose === 'prepayment' ? 'Предоплата за банкетное обслуживание' : 'Оплата банкетного обслуживания'} по заявке № ${s.number} от ${formatDateRu(s.eventDate)}`;
      const record: InvoiceRecord = {
        id: newId(),
        requestId,
        number,
        branchId: s.branchId,
        payerType: input.payerType,
        companyId,
        buyer,
        seller,
        purpose,
        description: description.slice(0, 500),
        amount,
        vat: seller.vatPayer ? amount.includedTax(seller.vatRateBp) : Money.zero(amount.currency),
        vatRateBp: seller.vatPayer ? seller.vatRateBp : 0,
        paid: Money.zero(amount.currency),
        refunded: Money.zero(amount.currency),
        dueDate,
        status: 'issued',
        paymentId: null,
        publicToken: randomToken(24),
        pdfFileKey: null,
        issuedAt: now,
        paidAt: null,
        cancelledAt: null,
        cancelReason: null,
        createdBy: actor.userId,
        createdByName: actor.name,
      };
      await this.invoices.insert(record);
      if (input.payerType === 'individual') {
        const payment = await this.payments.createPayment({
          purpose: PaymentPurpose.BanquetInvoice,
          referenceId: record.id,
          branchId: s.branchId,
          method: 'online',
          amount,
          description: `Счёт ${number} (банкет ${s.number})`,
          customer: { phone: s.contact.phone || null, name: s.contact.name, email: s.contact.email },
          returnUrl: this.links.invoice(record.publicToken, s.locale),
          idempotencyKey: onlinePaymentKey(record.id, 0),
        });
        await this.invoices.setPaymentId(record.id, payment.id);
      }
      await this.activities.add({
        requestId,
        kind: 'invoice_issued',
        data: { invoiceId: record.id, number, amount: amount.toJSON(), payerType: input.payerType, dueDate },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.invoice_issued',
        entityType: 'banquet_invoice',
        entityId: record.id,
        branchId: s.branchId,
        after: invoiceAudit(record),
        meta: { requestId, requestNumber: s.number },
        actor,
      });
      const payload: BanquetInvoiceIssuedPayload = {
        invoiceId: record.id,
        number,
        requestId,
        branchId: s.branchId,
        payerType: input.payerType,
        company: input.payerType === 'company' ? { name: buyer.name, bin: buyer.bin ?? '' } : null,
        amount: amount.toJSON(),
        dueDate,
        occurredAt: now.toISOString(),
      };
      await this.events.publish(BanquetEvents.InvoiceIssued, payload, { aggregateId: requestId, branchId: s.branchId });
      if (input.payerType === 'company' && s.contact.customerId) {
        await this.customers.addTag(s.contact.customerId, CustomerTag.Corporate);
      }
      // Счёт юрлицу — PDF с реквизитами сразу (вложение в письмо и ссылка на странице счёта).
      const pdf = input.payerType === 'company' ? await this.files.ensureInvoicePdf(record, actor) : null;
      await this.notifier.notifyGuest({
        recipient: { phone: buyer.phone || s.contact.phone || null, email: buyer.email ?? s.contact.email, name: s.contact.name },
        template: 'banquet.invoice_issued',
        params: {
          number: s.number,
          invoiceNumber: number,
          amount: formatTenge(amount),
          dueDate: formatDateRu(dueDate),
          paymentUrl: this.links.invoice(record.publicToken, s.locale),
        },
        locale: s.locale,
        attachments: pdf ? [{ fileKey: pdf.fileKey, filename: pdf.filename, contentType: 'application/pdf' }] : undefined,
        dedupeKey: `banquet:invoice:${record.id}:issued`,
        related: { type: 'banquet_request', id: s.id },
      });
      return (await this.invoices.findById(record.id))!;
    });
  }
}

export interface RecordInvoicePaymentInput {
  invoiceId: string;
  paymentId: string;
  amount: Money;
  method: string;
  paidAt: Date;
  documentNumber?: string | null;
}

export interface RecordInvoicePaymentResult {
  outcome: 'recorded' | 'duplicate' | 'refunded';
  invoice: InvoiceRecord;
}

/**
 * Поступление по счёту (онлайн-оплата по событию PaymentSucceeded или банковский перевод):
 * идемпотентно по платежу; сумма оплат не превышает сумму счёта — лишний платёж (поздняя оплата
 * отменённого счёта, двойная оплата) не засчитывается и возвращается автоматически.
 * Событие InvoicePaymentRecorded, уведомление гостю; при покрытии предоплаты — agreed → prepaid.
 */
@Injectable()
export class RecordInvoicePayment {
  constructor(
    private readonly requests: RequestRepository,
    private readonly invoices: InvoiceRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly funnel: BanquetFunnel,
    private readonly recorder: BanquetStatusRecorder,
    private readonly payments: PaymentsService,
    private readonly notifier: Notifier,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly clock: Clock,
  ) {}

  async execute(input: RecordInvoicePaymentInput, actor: Actor): Promise<RecordInvoicePaymentResult> {
    const found = await this.invoices.findById(input.invoiceId);
    if (!found) throw new NotFoundError('banquet_invoice', input.invoiceId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      const record = (await this.invoices.findById(input.invoiceId, { forUpdate: true }))!;
      if (await this.invoices.findPayment(input.paymentId)) return { outcome: 'duplicate' as const, invoice: record };
      const now = this.clock.now();
      const invoice = invoiceEntity(record);
      const s = request.snapshot();
      if (!invoice.canAccept(input.amount)) {
        // Деньги уже списаны у плательщика, но счёт их принять не может: полный возврат этого платежа.
        const reason = `Переплата по счёту ${record.number} (банкет ${s.number})`;
        const refund = await this.payments.requestRefund({ paymentId: input.paymentId, reason, idempotencyKey: `banquet-overpayment:${input.paymentId}` });
        await this.activities.add({
          requestId: s.id,
          kind: 'refund_requested',
          text: reason,
          data: { invoiceId: record.id, paymentId: input.paymentId, refundId: refund.id, amount: input.amount.toJSON(), automatic: true },
          actor,
          at: now,
        });
        await this.audit.record({
          action: 'banquet.overpayment_refunded',
          entityType: 'banquet_invoice',
          entityId: record.id,
          branchId: s.branchId,
          before: invoiceAudit(record),
          after: invoiceAudit(record),
          meta: { paymentId: input.paymentId, refundId: refund.id, amount: input.amount.toJSON() },
          actor,
        });
        return { outcome: 'refunded' as const, invoice: record };
      }
      const { fullyPaid } = invoice.recordPayment(input.amount, now);
      await this.invoices.insertPayment({
        id: newId(),
        invoiceId: record.id,
        paymentId: input.paymentId,
        method: input.method,
        amount: input.amount,
        refunded: Money.zero(input.amount.currency),
        documentNumber: input.documentNumber ?? null,
        paidAt: input.paidAt,
        recordedAt: now,
        recordedBy: actor.userId,
        recordedByName: actor.name,
      });
      await this.invoices.saveState(invoice);
      const updated = (await this.invoices.findById(record.id))!;
      await this.activities.add({
        requestId: s.id,
        kind: 'payment_recorded',
        data: { invoiceId: record.id, number: record.number, paymentId: input.paymentId, method: input.method, amount: input.amount.toJSON() },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.invoice_payment_recorded',
        entityType: 'banquet_invoice',
        entityId: record.id,
        branchId: s.branchId,
        before: invoiceAudit(record),
        after: invoiceAudit(updated),
        meta: { paymentId: input.paymentId, method: input.method, documentNumber: input.documentNumber ?? null },
        actor,
      });
      const payload: BanquetInvoicePaymentPayload = {
        invoiceId: record.id,
        requestId: s.id,
        branchId: s.branchId,
        paymentId: input.paymentId,
        amount: input.amount.toJSON(),
        paidTotal: updated.paid.toJSON(),
        remaining: invoice.remaining().toJSON(),
        fullyPaid,
        occurredAt: now.toISOString(),
      };
      await this.events.publish(BanquetEvents.InvoicePaymentRecorded, payload, { aggregateId: s.id, branchId: s.branchId });

      const before = request.auditView();
      await this.funnel.settlePrepayment(request, now);
      await this.requests.save(request);
      await this.recorder.record(request, { actor, before });

      const quote = await this.support.currentQuote(s.id);
      const paidNet = await this.support.paidNet(s.id);
      const remaining = quote ? quote.totals.total.subtract(paidNet).clampToZero() : invoice.remaining();
      await this.notifier.notifyGuest({
        recipient: { phone: s.contact.phone || null, email: s.contact.email, name: s.contact.name },
        template: 'banquet.payment_received',
        params: { number: s.number, amount: formatTenge(input.amount), remaining: formatTenge(remaining) },
        locale: s.locale,
        dedupeKey: `banquet:payment:${input.paymentId}`,
        related: { type: 'banquet_request', id: s.id },
      });
      return { outcome: 'recorded' as const, invoice: updated };
    });
  }
}

/**
 * Поступление по банковскому переводу (счёт юрлицу; также оплата физлица переводом): регистрирует
 * финансист, собственник или банкетный менеджер (banquets.invoice) по выписке. Сумма не может превысить
 * остаток по счёту (409). Идемпотентно: тот же документ и сумма повторно не засчитываются.
 */
@Injectable()
export class RegisterInvoiceBankTransfer {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly support: BanquetSupport,
    private readonly payments: PaymentsService,
    private readonly recordPayment: RecordInvoicePayment,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    invoiceId: string,
    input: { amount: Money; paidAt: Date; documentNumber: string },
  ): Promise<{ invoice: InvoiceRecord; paymentId: string; duplicate: boolean }> {
    const documentNumber = input.documentNumber.trim();
    if (!documentNumber || documentNumber.length > 60) throw new ValidationError('banquet_invoice.document_number_invalid', 'Payment document number is required');
    if (!input.amount.isPositive()) throw new ValidationError('banquet_invoice.invalid_amount', 'Payment amount must be positive');
    if (input.paidAt.getTime() > this.clock.now().getTime() + 60_000) {
      throw new ValidationError('banquet_invoice.paid_at_in_future', 'Payment date cannot be in the future');
    }
    const found = await this.invoices.findById(invoiceId);
    if (!found) throw new NotFoundError('banquet_invoice', invoiceId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      assertCanInvoice(actor, request);
      const record = (await this.invoices.findById(invoiceId, { forUpdate: true }))!;
      // Повтор регистрации того же платёжного документа — тот же результат (идемпотентность).
      const already = (await this.invoices.paymentsOf([record.id])).find(
        (p) => p.method === 'bank_transfer' && p.documentNumber === documentNumber && p.amount.equals(input.amount),
      );
      if (already) return { invoice: record, paymentId: already.paymentId, duplicate: true };
      invoiceEntity(record).assertCanAccept(input.amount);
      if (record.paymentId) {
        // Онлайн-ссылка по счёту больше не нужна: остаток оплачивается переводом (или новой ссылкой).
        const online = await this.payments.getPayment(record.paymentId);
        if (online.status === 'created' || online.status === 'pending') {
          await this.payments.cancelPayment(record.paymentId, `Счёт ${record.number} оплачен переводом`);
        }
      }
      const payment = await this.payments.registerBankTransfer({
        purpose: PaymentPurpose.BanquetInvoice,
        referenceId: record.id,
        branchId: record.branchId,
        amount: input.amount,
        paidAt: input.paidAt,
        documentNumber,
        idempotencyKey: `banquet-bank:${record.id}:${documentNumber}:${input.amount.amount}`,
      });
      const result = await this.recordPayment.execute(
        { invoiceId: record.id, paymentId: payment.id, amount: payment.amount, method: 'bank_transfer', paidAt: input.paidAt, documentNumber },
        actor,
      );
      return { invoice: result.invoice, paymentId: payment.id, duplicate: result.outcome === 'duplicate' };
    });
  }
}

/** Отмена счёта без поступлений (онлайн-платёж по нему отменяется). */
@Injectable()
export class CancelBanquetInvoice {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly payments: PaymentsService,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, invoiceId: string, reason: string | null): Promise<InvoiceRecord> {
    const found = await this.invoices.findById(invoiceId);
    if (!found) throw new NotFoundError('banquet_invoice', invoiceId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      assertCanInvoice(actor, request);
      const record = (await this.invoices.findById(invoiceId, { forUpdate: true }))!;
      const invoice = invoiceEntity(record);
      const now = this.clock.now();
      invoice.cancel(now);
      const text = reason?.trim() || null;
      await this.invoices.saveState(invoice, { cancelReason: text });
      if (record.paymentId) await this.payments.cancelPayment(record.paymentId, `Счёт ${record.number} отменён`);
      const updated = (await this.invoices.findById(invoiceId))!;
      await this.activities.add({
        requestId: record.requestId,
        kind: 'invoice_cancelled',
        text,
        data: { invoiceId, number: record.number },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.invoice_cancelled',
        entityType: 'banquet_invoice',
        entityId: invoiceId,
        branchId: record.branchId,
        before: invoiceAudit(record),
        after: invoiceAudit(updated),
        meta: { requestNumber: request.number, reason: text },
        actor,
      });
      return updated;
    });
  }
}

/** Счёт физлица ждёт онлайн-оплату (иначе 409): общие проверки ссылки на оплату. */
function assertOnlinePayable(record: InvoiceRecord, request: BanquetRequest): void {
  if (record.payerType !== 'individual') throw new ConflictError('banquet_invoice.bank_transfer_only', 'Company invoices are paid by bank transfer');
  if (record.status !== 'issued' && record.status !== 'partially_paid') {
    throw new ConflictError('banquet_invoice.not_payable', 'Invoice is not awaiting payment', { status: record.status });
  }
  if (request.status === 'cancelled') throw new ConflictError('banquet_invoice.not_payable', 'Request is cancelled');
}

/**
 * Действующий онлайн-платёж счёта: текущий, если ещё ждёт оплату (и не требуется новый), иначе новый
 * платёж на остаток по счёту (ключ идемпотентности — номер попытки). Вызывается в транзакции.
 */
@Injectable()
export class InvoiceOnlinePayment {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly payments: PaymentsService,
    private readonly links: BanquetLinks,
  ) {}

  async ensure(record: InvoiceRecord, request: BanquetRequest, options: { forceNew: boolean }): Promise<{ record: InvoiceRecord; previousPaymentId: string | null; renewed: boolean }> {
    if (record.paymentId) {
      const current = await this.payments.getPayment(record.paymentId);
      const active = current.status === 'created' || current.status === 'pending';
      if (active && !options.forceNew) return { record, previousPaymentId: null, renewed: false };
      if (active) await this.payments.cancelPayment(current.id, 'banquet_invoice_link_regenerated');
    }
    const s = request.snapshot();
    const attempts = (await this.payments.listForReference(PaymentPurpose.BanquetInvoice, record.id)).filter((p) => p.method === 'online').length;
    const payment = await this.payments.createPayment({
      purpose: PaymentPurpose.BanquetInvoice,
      referenceId: record.id,
      branchId: record.branchId,
      method: 'online',
      amount: invoiceEntity(record).remaining(),
      description: `Счёт ${record.number} (банкет ${s.number})`,
      customer: { phone: s.contact.phone || null, name: s.contact.name, email: s.contact.email },
      returnUrl: this.links.invoice(record.publicToken, s.locale),
      idempotencyKey: onlinePaymentKey(record.id, attempts),
    });
    await this.invoices.setPaymentId(record.id, payment.id);
    return { record: (await this.invoices.findById(record.id))!, previousPaymentId: record.paymentId, renewed: true };
  }
}

/**
 * Ссылка на онлайн-оплату счёта физлица с витрины: если прежняя ссылка истекла, отменена или платёж не прошёл,
 * создаётся новый платёж на остаток по счёту. Действующая ссылка возвращается как есть.
 */
@Injectable()
export class RenewInvoicePayment {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly support: BanquetSupport,
    private readonly online: InvoiceOnlinePayment,
    private readonly database: Database,
  ) {}

  async execute(token: string): Promise<InvoiceRecord> {
    const found = await this.invoices.findByToken(token);
    if (!found) throw new NotFoundError('banquet_invoice');
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      const record = (await this.invoices.findById(found.id, { forUpdate: true }))!;
      assertOnlinePayable(record, request);
      return (await this.online.ensure(record, request, { forceNew: false })).record;
    });
  }
}

/**
 * Менеджер повторно отправляет гостю ссылку на оплату счёта (banquets.invoice). Если прежний платёж
 * не прошёл / отменён / истёк — создаётся новый на остаток; regenerate — принудительно новая ссылка
 * (прежний неоплаченный платёж отменяется). Гостю уходит уведомление со ссылкой на страницу счёта.
 */
@Injectable()
export class ResendInvoicePaymentLink {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly support: BanquetSupport,
    private readonly online: InvoiceOnlinePayment,
    private readonly notifier: Notifier,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, invoiceId: string, input: { regenerate?: boolean }): Promise<InvoiceRecord> {
    const found = await this.invoices.findById(invoiceId);
    if (!found) throw new NotFoundError('banquet_invoice', invoiceId);
    return this.database.transaction(async () => {
      const request = await this.support.load(found.requestId, { forUpdate: true });
      assertCanInvoice(actor, request);
      const record = (await this.invoices.findById(found.id, { forUpdate: true }))!;
      assertOnlinePayable(record, request);
      const result = await this.online.ensure(record, request, { forceNew: input.regenerate === true });
      const updated = result.record;
      const s = request.snapshot();
      const now = this.clock.now();
      await this.audit.record({
        action: 'banquet.invoice_payment_link_sent',
        entityType: 'banquet_invoice',
        entityId: record.id,
        branchId: record.branchId,
        before: { paymentId: record.paymentId },
        after: { paymentId: updated.paymentId },
        meta: { number: record.number, requestNumber: s.number, renewed: result.renewed, regenerate: input.regenerate === true },
        actor,
      });
      await this.notifier.notifyGuest({
        recipient: { phone: s.contact.phone || null, email: s.contact.email, name: s.contact.name },
        template: 'banquet.invoice_issued',
        params: {
          number: s.number,
          invoiceNumber: record.number,
          amount: formatTenge(invoiceEntity(updated).remaining()),
          dueDate: formatDateRu(record.dueDate),
          paymentUrl: this.links.invoice(record.publicToken, s.locale),
        },
        locale: s.locale,
        dedupeKey: `banquet:invoice:${record.id}:link:${updated.paymentId}:${now.getTime()}`,
        related: { type: 'banquet_request', id: s.id },
      });
      return updated;
    });
  }
}

/**
 * Возврат полученной оплаты по банкету (например, предоплаты при отмене): только с правом payments.refund
 * (финансы, собственник). Возврат выполняет модуль Payments через очередь; идемпотентно по ключу.
 */
@Injectable()
export class RefundBanquetPayment {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly payments: PaymentsService,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    requestId: string,
    input: { paymentId: string; amount?: Money | null; reason: string; idempotencyKey: string },
  ): Promise<RefundView> {
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError('banquet.refund_reason_required', 'Refund reason is required');
    return this.database.transaction(async () => {
      const request = await this.support.load(requestId, { forUpdate: true });
      actor.assertCan(Permission.PaymentsRefund, request.branchId);
      const payment = await this.invoices.findPayment(input.paymentId);
      const invoice = payment ? await this.invoices.findById(payment.invoiceId) : null;
      if (!payment || !invoice || invoice.requestId !== requestId) throw new NotFoundError('banquet_payment', input.paymentId);
      if (input.amount && !input.amount.isPositive()) throw new ValidationError('banquet.refund_amount_invalid', 'Refund amount must be positive');
      const refund = await this.payments.requestRefund({
        paymentId: input.paymentId,
        amount: input.amount ?? undefined,
        reason: `${reason} (банкет ${request.number})`,
        idempotencyKey: `banquet-refund:${input.idempotencyKey}`,
      });
      const now = this.clock.now();
      await this.activities.add({
        requestId,
        kind: 'refund_requested',
        text: reason,
        data: { invoiceId: invoice.id, paymentId: input.paymentId, refundId: refund.id, amount: refund.amount.toJSON() },
        actor,
        at: now,
      });
      await this.audit.record({
        action: 'banquet.refund_requested',
        entityType: 'banquet_invoice',
        entityId: invoice.id,
        branchId: request.branchId,
        before: invoiceAudit(invoice),
        after: { ...invoiceAudit(invoice), refundRequested: refund.amount.toJSON() },
        meta: { paymentId: input.paymentId, refundId: refund.id, reason, requestNumber: request.number },
        actor,
      });
      return refund;
    });
  }
}

/** Возврат прошёл (событие RefundSucceeded): учёт возвращённой суммы по платежу и счёту. */
@Injectable()
export class RecordInvoiceRefund {
  private readonly logger = new Logger(RecordInvoiceRefund.name);

  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: { paymentId: string; refundId: string; amount: Money; reason: string }, actor: Actor): Promise<void> {
    const payment = await this.invoices.findPayment(input.paymentId);
    if (!payment) {
      this.logger.warn({ paymentId: input.paymentId }, 'Refund for a banquet payment that was not recorded on an invoice');
      return;
    }
    await this.database.transaction(async () => {
      const found = (await this.invoices.findById(payment.invoiceId))!;
      await this.support.load(found.requestId, { forUpdate: true });
      const record = (await this.invoices.findById(payment.invoiceId, { forUpdate: true }))!;
      const invoice = invoiceEntity(record);
      invoice.recordRefund(input.amount);
      await this.invoices.addPaymentRefund(input.paymentId, input.amount);
      await this.invoices.saveState(invoice);
      const updated = (await this.invoices.findById(record.id))!;
      await this.activities.add({
        requestId: record.requestId,
        kind: 'refund_recorded',
        text: input.reason,
        data: { invoiceId: record.id, paymentId: input.paymentId, refundId: input.refundId, amount: input.amount.toJSON() },
        actor,
        at: this.clock.now(),
      });
      await this.audit.record({
        action: 'banquet.invoice_refund_recorded',
        entityType: 'banquet_invoice',
        entityId: record.id,
        branchId: record.branchId,
        before: invoiceAudit(record),
        after: invoiceAudit(updated),
        meta: { paymentId: input.paymentId, refundId: input.refundId },
        actor,
      });
    });
  }
}
