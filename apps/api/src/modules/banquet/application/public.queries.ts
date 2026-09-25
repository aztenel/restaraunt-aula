import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { MoneyJson } from '../../../shared/kernel/money';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { PaymentsService } from '../../payments/public';
import { BanquetRequest } from '../domain/banquet-request';
import { InvoiceStatus, PayerType } from '../domain/invoice';
import { BANQUET_EVENT_TYPES, EVENT_TYPE_LABELS, eventTypeLabel, statusLabel } from '../domain/texts';
import { InvoiceRecord, InvoiceRepository } from '../infrastructure/invoice.repository';
import { QuoteRepository } from '../infrastructure/quote.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { BanquetStatus } from '../public';
import { BanquetSupport } from './banquet-support';
import { BanquetDocumentFiles, GUEST_LINK_TTL_SECONDS } from './document-files';
import { discountView, DiscountView } from './views';

export interface PublicQuoteView {
  requestNumber: string;
  status: BanquetStatus;
  statusLabel: string;
  eventDate: string;
  eventTime: string | null;
  eventType: string;
  eventTypeLabel: string;
  guests: number;
  place: string;
  version: number;
  lines: Array<{ title: string; unit: string; quantity: number; unitPrice: MoneyJson; discount: DiscountView | null; total: MoneyJson }>;
  subtotal: MoneyJson;
  discount: MoneyJson;
  serviceChargeBp: number;
  service: MoneyJson;
  total: MoneyJson;
  vatPayer: boolean;
  vatRateBp: number;
  vat: MoneyJson;
  perGuest: MoneyJson;
  validUntil: string | null;
  notes: string | null;
  /** Смету можно согласовать сейчас (статус quote_sent, последняя версия, срок не истёк). */
  canAccept: boolean;
  accepted: boolean;
  pdfUrl: string;
  manager: { name: string; phone: string | null };
}

export interface PublicInvoiceView {
  number: string;
  requestNumber: string;
  status: InvoiceStatus;
  payerType: PayerType;
  description: string;
  amount: MoneyJson;
  paid: MoneyJson;
  remaining: MoneyJson;
  vatRateBp: number;
  vat: MoneyJson;
  dueDate: string;
  overdue: boolean;
  /** Ссылка на онлайн-оплату (физлицо); появляется асинхронно — витрина опрашивает страницу. */
  paymentUrl: string | null;
  paymentStatus: string | null;
  /** PDF счёта на оплату с реквизитами (юрлицо). */
  pdfUrl: string | null;
  seller: { name: string; bin: string; iban: string; bik: string; bankName: string; kbe: string } | null;
}

export interface EventTypeView {
  code: string;
  label: string;
}

const GUEST = Actor.system('banquet.public');

/** Публичные страницы: смета по ссылке, счёт по ссылке, справочник типов мероприятий. */
@Injectable()
export class PublicBanquetQueries {
  constructor(
    private readonly requests: RequestRepository,
    private readonly quotes: QuoteRepository,
    private readonly invoices: InvoiceRepository,
    private readonly support: BanquetSupport,
    private readonly files: BanquetDocumentFiles,
    private readonly payments: PaymentsService,
  ) {}

  eventTypes(locale: Locale): EventTypeView[] {
    return BANQUET_EVENT_TYPES.map((code) => ({ code, label: translate(EVENT_TYPE_LABELS[code], locale) }));
  }

  /** Последняя отправленная клиенту версия сметы (черновики не показываются). */
  async quote(token: string, locale: Locale): Promise<PublicQuoteView> {
    const request = await this.requests.findByToken(token);
    if (!request) throw new NotFoundError('banquet_quote');
    const quote = await this.quotes.latestSent(request.id);
    if (!quote) throw new NotFoundError('banquet_quote');
    const latest = await this.quotes.latest(request.id);
    const s = request.snapshot();
    const today = await this.support.today(s.branchId);
    const pdf = await this.files.ensureQuotePdf(quote, GUEST);
    const link = await this.files.link(pdf.fileKey, pdf.filename, GUEST_LINK_TTL_SECONDS);
    const manager = await this.support.manager(s.managerId);
    return {
      requestNumber: s.number,
      status: s.status,
      statusLabel: statusLabel(s.status, locale),
      eventDate: s.eventDate,
      eventTime: s.eventTime,
      eventType: s.eventType,
      eventTypeLabel: eventTypeLabel(s.eventType, locale),
      guests: quote.guests,
      place: await this.support.placeLabel(request, locale),
      version: quote.version,
      lines: quote.lines.map((l) => ({
        title: translate(l.title, locale),
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice.toJSON(),
        discount: discountView(l.discount),
        total: l.total.toJSON(),
      })),
      subtotal: quote.totals.subtotal.toJSON(),
      discount: quote.totals.discount.toJSON(),
      serviceChargeBp: quote.serviceChargeBp,
      service: quote.totals.service.toJSON(),
      total: quote.totals.total.toJSON(),
      vatPayer: quote.vat.payer,
      vatRateBp: quote.vat.rateBp,
      vat: quote.totals.vat.toJSON(),
      perGuest: quote.totals.perGuest.toJSON(),
      validUntil: quote.validUntil,
      notes: quote.notes,
      canAccept: s.status === 'quote_sent' && latest?.id === quote.id && (!quote.validUntil || quote.validUntil >= today),
      accepted: quote.acceptedAt !== null,
      pdfUrl: link.url,
      manager: { name: manager.name, phone: manager.phone },
    };
  }

  async invoice(token: string): Promise<PublicInvoiceView> {
    const invoice = await this.invoices.findByToken(token);
    if (!invoice) throw new NotFoundError('banquet_invoice');
    const request = await this.requests.findById(invoice.requestId);
    if (!request) throw new NotFoundError('banquet_invoice');
    return this.invoiceView(invoice, request);
  }

  async invoiceView(invoice: InvoiceRecord, request: BanquetRequest): Promise<PublicInvoiceView> {
    const today = await this.support.today(invoice.branchId);
    const payment = invoice.paymentId ? await this.payments.getPayment(invoice.paymentId) : null;
    const payable = invoice.status === 'issued' || invoice.status === 'partially_paid';
    let pdfUrl: string | null = null;
    if (invoice.payerType === 'company') {
      const pdf = await this.files.ensureInvoicePdf(invoice, GUEST);
      pdfUrl = (await this.files.link(pdf.fileKey, pdf.filename, GUEST_LINK_TTL_SECONDS)).url;
    }
    const s = invoice.seller;
    return {
      number: invoice.number,
      requestNumber: request.number,
      status: invoice.status,
      payerType: invoice.payerType,
      description: invoice.description,
      amount: invoice.amount.toJSON(),
      paid: invoice.paid.toJSON(),
      remaining: invoice.amount.subtract(invoice.paid).clampToZero().toJSON(),
      vatRateBp: invoice.vatRateBp,
      vat: invoice.vat.toJSON(),
      dueDate: invoice.dueDate,
      overdue: payable && invoice.dueDate < today,
      paymentUrl: payable && payment && (payment.status === 'pending' || payment.status === 'created') ? payment.paymentUrl : null,
      paymentStatus: payment?.status ?? null,
      pdfUrl,
      seller: invoice.payerType === 'company' ? { name: s.name, bin: s.bin, iban: s.iban, bik: s.bik, bankName: s.bankName, kbe: s.kbe } : null,
    };
  }
}
