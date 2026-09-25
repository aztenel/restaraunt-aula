import { Money, MoneyJson } from '../../../shared/kernel/money';
import { PaymentView, RefundView } from '../../payments/public';
import { Translatable } from '../../../shared/kernel/translatable';
import { BanquetRequest } from '../domain/banquet-request';
import { EsfStatus } from '../domain/esf';
import { activePaymentUrl } from './invoice-payments-info';
import { InvoicePurpose, InvoiceStatus, PayerType } from '../domain/invoice';
import { CalculatedQuoteLine, QuoteDiscount, QuoteTotals } from '../domain/quote';
import { SellerSnapshot } from '../domain/requisites';
import { slaDeadline } from '../domain/sla';
import { QuoteLineKind } from '../domain/texts';
import { ActivityKind, ActivityRecord } from '../infrastructure/activity.repository';
import { ActRecord, DocumentKind, DocumentRecord } from '../infrastructure/document.repository';
import { InvoicePaymentRecord, InvoiceRecord } from '../infrastructure/invoice.repository';
import { QuoteRecord, QuoteSummary } from '../infrastructure/quote.repository';
import { BanquetContact, BanquetStatus } from '../public';

/** Представления для API (DTO описывают ту же форму в OpenAPI). Суммы — { amount, currency }. */
export interface RequestSummaryView {
  id: string;
  number: string;
  status: BanquetStatus;
  source: 'web' | 'admin';
  branchId: string | null;
  branchName: Translatable | null;
  isOffsite: boolean;
  offsiteAddress: string | null;
  eventDate: string;
  eventTime: string | null;
  eventType: string;
  guests: number;
  budget: MoneyJson | null;
  contact: BanquetContact;
  managerId: string;
  managerName: string;
  quoteVersion: number | null;
  quoteTotal: MoneyJson | null;
  slaDeadline: Date;
  slaBreached: boolean;
  firstResponseAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscountView {
  type: 'percent' | 'amount';
  bp: number | null;
  amount: MoneyJson | null;
}

export interface QuoteLineView {
  position: number;
  kind: QuoteLineKind;
  dishId: string | null;
  title: Translatable;
  unit: string;
  quantity: number;
  unitPrice: MoneyJson;
  discount: DiscountView | null;
  gross: MoneyJson;
  discountAmount: MoneyJson;
  total: MoneyJson;
}

export interface QuoteTotalsView {
  subtotal: MoneyJson;
  linesDiscount: MoneyJson;
  overallDiscount: MoneyJson;
  discount: MoneyJson;
  service: MoneyJson;
  total: MoneyJson;
  vat: MoneyJson;
  perGuest: MoneyJson;
}

export interface QuoteSummaryView {
  id: string;
  requestId: string;
  version: number;
  guests: number;
  total: MoneyJson;
  vat: MoneyJson;
  linesCount: number;
  validUntil: string | null;
  createdByName: string;
  createdAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  isLatest: boolean;
}

export interface QuoteView {
  id: string;
  requestId: string;
  version: number;
  branchId: string | null;
  guests: number;
  discount: DiscountView | null;
  serviceChargeBp: number;
  vatPayer: boolean;
  vatRateBp: number;
  lines: QuoteLineView[];
  totals: QuoteTotalsView;
  validUntil: string | null;
  notes: string | null;
  seller: { name: string; bin: string };
  pdfReady: boolean;
  createdByName: string;
  createdAt: Date;
  sentAt: Date | null;
  acceptedAt: Date | null;
  isLatest: boolean;
}

/** Предпросмотр сметы: итоги без сохранения версии. */
export interface QuotePreviewView {
  requestId: string;
  branchId: string | null;
  guests: number;
  discount: DiscountView | null;
  serviceChargeBp: number;
  vatPayer: boolean;
  vatRateBp: number;
  lines: QuoteLineView[];
  totals: QuoteTotalsView;
  validUntil: string;
  notes: string | null;
  seller: { name: string; bin: string };
}

export interface InvoicePaymentView {
  paymentId: string;
  method: string;
  amount: MoneyJson;
  refunded: MoneyJson;
  /** Сколько ещё можно вернуть: сумма минус прошедшие и ожидающие возвраты. */
  refundable: MoneyJson;
  documentNumber: string | null;
  paidAt: Date;
  recordedByName: string;
}

export interface InvoiceRefundView {
  refundId: string;
  paymentId: string;
  amount: MoneyJson;
  status: 'pending' | 'succeeded' | 'failed';
  reason: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface InvoiceView {
  id: string;
  requestId: string;
  number: string;
  branchId: string | null;
  payerType: PayerType;
  companyId: string | null;
  buyer: { name: string; bin: string | null };
  purpose: InvoicePurpose;
  description: string;
  amount: MoneyJson;
  vat: MoneyJson;
  vatRateBp: number;
  paid: MoneyJson;
  refunded: MoneyJson;
  remaining: MoneyJson;
  dueDate: string;
  status: InvoiceStatus;
  overdue: boolean;
  paymentId: string | null;
  publicUrl: string;
  pdfReady: boolean;
  issuedAt: Date;
  paidAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  payments: InvoicePaymentView[];
  /** Ссылка на онлайн-оплату текущего платежа (физлицо), пока он ждёт оплату. */
  paymentUrl: string | null;
  /** Статус текущего онлайн-платежа (created, pending, succeeded, failed, cancelled...). */
  paymentStatus: string | null;
  /** Можно отправить (перевыпустить) ссылку на оплату: счёт физлица ждёт оплату. */
  canResendPaymentLink: boolean;
  refunds: InvoiceRefundView[];
}

export interface ActView {
  id: string;
  number: string;
  actDate: string;
  payerType: PayerType;
  buyer: { name: string; bin: string | null };
  amount: MoneyJson;
  vat: MoneyJson;
  esf: {
    status: EsfStatus;
    provider: string | null;
    esfId: string | null;
    registrationNumber: string | null;
    error: string | null;
    updatedAt: Date | null;
  };
  /** ЭСФ можно отправить повторно (не удалась или ждёт ручной загрузки черновика). */
  esfRetryable: boolean;
  createdAt: Date;
}

export interface DocumentView {
  id: string;
  kind: DocumentKind;
  number: string | null;
  title: string;
  filename: string;
  contentType: string;
  createdByName: string;
  createdAt: Date;
}

export interface ActivityView {
  id: string;
  kind: ActivityKind;
  text: string | null;
  data: Record<string, unknown>;
  authorKind: 'staff' | 'system' | 'guest';
  authorName: string;
  occurredAt: Date;
}

export function discountView(d: QuoteDiscount): DiscountView | null {
  if (!d) return null;
  return d.type === 'percent' ? { type: 'percent', bp: d.bp, amount: null } : { type: 'amount', bp: null, amount: d.amount.toJSON() };
}

export function requestSummaryView(
  request: BanquetRequest,
  extra: { branchName: Translatable | null; managerName: string; quote: { version: number; total: MoneyJson } | null; now: Date },
): RequestSummaryView {
  const s = request.snapshot();
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    source: s.source,
    branchId: s.branchId,
    branchName: extra.branchName,
    isOffsite: s.isOffsite,
    offsiteAddress: s.offsiteAddress,
    eventDate: s.eventDate,
    eventTime: s.eventTime,
    eventType: s.eventType,
    guests: s.guests,
    budget: s.budget?.toJSON() ?? null,
    contact: request.contact(),
    managerId: s.managerId,
    managerName: extra.managerName,
    quoteVersion: extra.quote?.version ?? null,
    quoteTotal: extra.quote?.total ?? null,
    slaDeadline: slaDeadline(s.createdAt),
    slaBreached: s.slaBreachedAt !== null || request.isSlaBreached(extra.now),
    firstResponseAt: s.firstResponseAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function lineView(l: CalculatedQuoteLine): QuoteLineView {
  return {
    position: l.position,
    kind: l.kind,
    dishId: l.dishId,
    title: l.title,
    unit: l.unit,
    quantity: l.quantity,
    unitPrice: l.unitPrice.toJSON(),
    discount: discountView(l.discount),
    gross: l.gross.toJSON(),
    discountAmount: l.discountAmount.toJSON(),
    total: l.total.toJSON(),
  };
}

function totalsView(t: QuoteTotals): QuoteTotalsView {
  return {
    subtotal: t.subtotal.toJSON(),
    linesDiscount: t.linesDiscount.toJSON(),
    overallDiscount: t.overallDiscount.toJSON(),
    discount: t.discount.toJSON(),
    service: t.service.toJSON(),
    total: t.total.toJSON(),
    vat: t.vat.toJSON(),
    perGuest: t.perGuest.toJSON(),
  };
}

export function quotePreviewView(input: {
  requestId: string;
  branchId: string | null;
  guests: number;
  discount: QuoteDiscount;
  serviceChargeBp: number;
  seller: SellerSnapshot;
  lines: CalculatedQuoteLine[];
  totals: QuoteTotals;
  validUntil: string;
  notes: string | null;
}): QuotePreviewView {
  return {
    requestId: input.requestId,
    branchId: input.branchId,
    guests: input.guests,
    discount: discountView(input.discount),
    serviceChargeBp: input.serviceChargeBp,
    vatPayer: input.seller.vatPayer,
    vatRateBp: input.seller.vatRateBp,
    lines: input.lines.map(lineView),
    totals: totalsView(input.totals),
    validUntil: input.validUntil,
    notes: input.notes,
    seller: { name: input.seller.name, bin: input.seller.bin },
  };
}

export function quoteView(q: QuoteRecord, latestVersion: number | null): QuoteView {
  return {
    id: q.id,
    requestId: q.requestId,
    version: q.version,
    branchId: q.branchId,
    guests: q.guests,
    discount: discountView(q.discount),
    serviceChargeBp: q.serviceChargeBp,
    vatPayer: q.vat.payer,
    vatRateBp: q.vat.rateBp,
    lines: q.lines.map((l) => ({
      position: l.position,
      kind: l.kind,
      dishId: l.dishId,
      title: l.title,
      unit: l.unit,
      quantity: l.quantity,
      unitPrice: l.unitPrice.toJSON(),
      discount: discountView(l.discount),
      gross: l.gross.toJSON(),
      discountAmount: l.discountAmount.toJSON(),
      total: l.total.toJSON(),
    })),
    totals: {
      subtotal: q.totals.subtotal.toJSON(),
      linesDiscount: q.totals.linesDiscount.toJSON(),
      overallDiscount: q.totals.overallDiscount.toJSON(),
      discount: q.totals.discount.toJSON(),
      service: q.totals.service.toJSON(),
      total: q.totals.total.toJSON(),
      vat: q.totals.vat.toJSON(),
      perGuest: q.totals.perGuest.toJSON(),
    },
    validUntil: q.validUntil,
    notes: q.notes,
    seller: { name: q.seller.name, bin: q.seller.bin },
    pdfReady: q.pdfFileKey !== null,
    createdByName: q.createdByName,
    createdAt: q.createdAt,
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt,
    isLatest: latestVersion === q.version,
  };
}

export function quoteSummaryView(q: QuoteSummary, latestVersion: number | null): QuoteSummaryView {
  return {
    id: q.id,
    requestId: q.requestId,
    version: q.version,
    guests: q.guests,
    total: q.totals.total.toJSON(),
    vat: q.totals.vat.toJSON(),
    linesCount: q.linesCount,
    validUntil: q.validUntil,
    createdByName: q.createdByName,
    createdAt: q.createdAt,
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt,
    isLatest: latestVersion === q.version,
  };
}

export function invoiceView(
  r: InvoiceRecord,
  payments: InvoicePaymentRecord[],
  extra: {
    today: string;
    publicUrl: string;
    /** Текущий онлайн-платёж счёта (ссылка на оплату). */
    currentPayment?: PaymentView;
    refunds?: readonly RefundView[];
    requestCancelled?: boolean;
  },
): InvoiceView {
  const own = payments.filter((p) => p.invoiceId === r.id);
  const ownIds = new Set(own.map((p) => p.paymentId));
  const refunds = (extra.refunds ?? []).filter((x) => ownIds.has(x.paymentId));
  const awaiting = r.status === 'issued' || r.status === 'partially_paid';
  return {
    id: r.id,
    requestId: r.requestId,
    number: r.number,
    branchId: r.branchId,
    payerType: r.payerType,
    companyId: r.companyId,
    buyer: { name: r.buyer.name, bin: r.buyer.bin },
    purpose: r.purpose,
    description: r.description,
    amount: r.amount.toJSON(),
    vat: r.vat.toJSON(),
    vatRateBp: r.vatRateBp,
    paid: r.paid.toJSON(),
    refunded: r.refunded.toJSON(),
    remaining: r.amount.subtract(r.paid).clampToZero().toJSON(),
    dueDate: r.dueDate,
    status: r.status,
    overdue: (r.status === 'issued' || r.status === 'partially_paid') && r.dueDate < extra.today,
    paymentId: r.paymentId,
    publicUrl: extra.publicUrl,
    pdfReady: r.pdfFileKey !== null,
    issuedAt: r.issuedAt,
    paidAt: r.paidAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    payments: own.map((p) => {
      const reserved = Money.sum(
        refunds.filter((x) => x.paymentId === p.paymentId && x.status !== 'failed').map((x) => x.amount),
        p.amount.currency,
      );
      // Возвраты, прошедшие до учёта в Payments, отражены в refunded — берём большее из двух.
      const used = reserved.greaterThan(p.refunded) ? reserved : p.refunded;
      return {
        paymentId: p.paymentId,
        method: p.method,
        amount: p.amount.toJSON(),
        refunded: p.refunded.toJSON(),
        refundable: p.amount.subtract(used).clampToZero().toJSON(),
        documentNumber: p.documentNumber,
        paidAt: p.paidAt,
        recordedByName: p.recordedByName,
      };
    }),
    paymentUrl: activePaymentUrl(extra.currentPayment),
    paymentStatus: extra.currentPayment?.status ?? null,
    canResendPaymentLink: r.payerType === 'individual' && awaiting && !extra.requestCancelled,
    refunds: refunds.map((x) => ({
      refundId: x.id,
      paymentId: x.paymentId,
      amount: x.amount.toJSON(),
      status: x.status,
      reason: x.reason,
      createdAt: x.createdAt,
      completedAt: x.completedAt ?? null,
    })),
  };
}

export function actView(a: ActRecord): ActView {
  return {
    id: a.id,
    number: a.number,
    actDate: a.actDate,
    payerType: a.payerType,
    buyer: { name: a.buyer.name, bin: a.buyer.bin },
    amount: a.amount.toJSON(),
    vat: a.vat.toJSON(),
    esf: {
      status: a.esf.status,
      provider: a.esf.provider,
      esfId: a.esf.esfId,
      registrationNumber: a.esf.registrationNumber,
      error: a.esf.error,
      updatedAt: a.esf.updatedAt,
    },
    esfRetryable: a.esf.status === 'failed' || a.esf.status === 'draft_ready',
    createdAt: a.createdAt,
  };
}

export function documentView(d: DocumentRecord): DocumentView {
  return {
    id: d.id,
    kind: d.kind,
    number: d.number,
    title: d.title,
    filename: d.filename,
    contentType: d.contentType,
    createdByName: d.createdByName,
    createdAt: d.createdAt,
  };
}

export function activityView(a: ActivityRecord): ActivityView {
  return {
    id: a.id,
    kind: a.kind,
    text: a.text,
    data: a.data,
    authorKind: a.authorKind,
    authorName: a.authorName,
    occurredAt: a.occurredAt,
  };
}
