/**
 * Формы API модуля Banquet (apps/api/src/modules/banquet/http/*.dto.ts) — из сгенерированной схемы
 * docs/openapi.json. Все суммы — тиыны от сервера; фронт их только показывает и отправляет ввод.
 * Словари (статусы, типы мероприятий, виды позиций) повторяют доменные константы модуля.
 */
import type { Money, Schemas, Translatable } from '@aula/api-client';

export const BANQUET_STATUSES = ['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held', 'cancelled'] as const;
export type BanquetStatus = (typeof BANQUET_STATUSES)[number];

/** Колонки воронки (отменённые — отдельной свёрнутой колонкой). */
export const PIPELINE_COLUMNS = ['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held'] as const satisfies readonly BanquetStatus[];

export const EVENT_TYPES = ['wedding', 'birthday', 'corporate', 'anniversary', 'kudalyk', 'memorial', 'graduation', 'other'] as const;
export type BanquetEventType = (typeof EVENT_TYPES)[number];

export const QUOTE_LINE_KINDS = ['menu', 'hall_rent', 'musicians', 'decoration', 'service', 'other'] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];
/** Произвольные позиции сметы (аренда зала, музыканты, оформление, обслуживание, прочее). */
export const CUSTOM_LINE_KINDS = ['hall_rent', 'musicians', 'decoration', 'service', 'other'] as const satisfies readonly QuoteLineKind[];
export type CustomLineKind = (typeof CUSTOM_LINE_KINDS)[number];

/** Записи ленты заявки, которые менеджер добавляет вручную (звонок/контакт/встреча — первый ответ по SLA). */
export const MANUAL_ACTIVITY_KINDS = ['call', 'contact', 'meeting', 'note'] as const;
export type ManualActivityKind = (typeof MANUAL_ACTIVITY_KINDS)[number];

export const INVOICE_STATUSES = ['issued', 'partially_paid', 'paid', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PAYER_TYPES = ['individual', 'company'] as const;
export type PayerType = (typeof PAYER_TYPES)[number];

export const ESF_STATUSES = ['not_required', 'pending', 'draft_ready', 'sent', 'registered', 'failed'] as const;
export type EsfStatus = (typeof ESF_STATUSES)[number];

export const DOCUMENT_KINDS = ['quote', 'contract', 'invoice', 'act', 'esf_xml'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type BanquetRequestSummary = Schemas['BanquetRequestSummaryDto'];
export type BanquetRequestDetail = Schemas['BanquetRequestDetailDto'];
export type PipelineColumn = Schemas['BanquetPipelineColumnDto'];
export type BanquetManager = Schemas['BanquetManagerDto'];
export type BanquetActivity = Schemas['BanquetActivityDto'];
export type BanquetVenueHold = Schemas['BanquetVenueHoldDto'];
export type QuoteSummary = Schemas['BanquetQuoteSummaryDto'];
export type Quote = Schemas['BanquetQuoteDto'];
/** Предпросмотр сметы (POST /requests/{id}/quotes/preview): итоги по правилам сохранения, без новой версии. */
export type QuotePreview = Schemas['BanquetQuotePreviewDto'];
export type QuoteLine = Schemas['BanquetQuoteLineDto'];
export type QuoteDiscount = Schemas['BanquetDiscountDto'];
export type DishOption = Schemas['BanquetDishOptionDto'];
export type Invoice = Schemas['BanquetInvoiceDto'];
export type InvoiceListItem = Schemas['BanquetInvoiceListItemDto'];
export type InvoicePayment = Schemas['BanquetInvoicePaymentDto'];
export type InvoiceRefund = Schemas['BanquetInvoiceRefundDto'];
export type BankTransferResult = Schemas['BanquetBankTransferResultDto'];
export type RefundResult = Schemas['BanquetRefundResultDto'];
export type BanquetAct = Schemas['BanquetActDto'];
export type BanquetDocument = Schemas['BanquetDocumentDto'];
export type ClientCompany = Schemas['BanquetCompanyDto'];
export type ContractTemplate = Schemas['BanquetContractTemplateDto'];
export type TemplatePlaceholder = Schemas['BanquetPlaceholderDto'];
export type SignedLink = Schemas['BanquetSignedLinkDto'];
export type SlaStats = Schemas['BanquetSlaStatsDto'];
export type ManagerSla = Schemas['BanquetManagerSlaDto'];
export type BanquetCalendar = Schemas['BanquetCalendarDto'];
export type CalendarVenue = Schemas['BanquetCalendarVenueDto'];
export type VenueOccupancy = Schemas['BanquetOccupancyDto'];

// ---------------------------------------------------------------- Ввод

export interface MoneyInput {
  amount: number;
  currency: 'KZT';
}

export function moneyInput(tiyn: number): MoneyInput {
  return { amount: tiyn, currency: 'KZT' };
}

export interface ContactInput {
  name: string;
  phone: string;
  email?: string;
}

export type CreateRequestInput = Schemas['BanquetAdminCreateRequestDto'];

/** PATCH /admin/banquets/requests/{id}: nullable-поля (время, бюджет, филиал, адрес, пожелания, компания) очищаются явным null. */
export type UpdateRequestInput = Schemas['BanquetUpdateRequestDto'];

export type DiscountInput = { type: 'percent'; bp: number } | { type: 'amount'; amount: MoneyInput };

export interface QuoteLineInput {
  kind: QuoteLineKind;
  dishId?: string;
  title?: Translatable;
  unit?: string;
  unitPrice?: MoneyInput;
  quantity: number;
  discount?: DiscountInput;
}

export interface SaveQuoteInput {
  lines: QuoteLineInput[];
  discount?: DiscountInput;
  serviceChargeBp?: number;
  guests?: number;
  validUntil?: string;
  notes?: string;
  refreshMenuPrices?: boolean;
}

export type IssueInvoiceInput = Schemas['BanquetIssueInvoiceDto'];
export type BankTransferInput = Schemas['BanquetBankTransferDto'];
export type RefundInput = Schemas['BanquetRefundInputDto'];
export type CompanyInput = Schemas['BanquetCompanyInputDto'];
export type TemplateInput = Schemas['BanquetTemplateInputDto'];
export type SetVenueInput = Schemas['BanquetSetVenueDto'];

export interface RequestListQuery {
  status?: BanquetStatus[];
  managerId?: string;
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  offsite?: boolean;
  slaBreached?: boolean;
  page?: number;
  perPage?: number;
}

export interface PipelineQuery {
  branchId?: string;
  managerId?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Номер, имя или телефон. */
  q?: string;
  /** true — только выездные, false — только в залах филиалов. */
  offsite?: boolean;
  slaBreached?: boolean;
}

/** Календарь: без филиала — все доступные филиалы и выездные заявки. */
export interface CalendarQuery {
  branchId?: string;
  from: string;
  to: string;
}

export interface InvoiceListQuery {
  branchId?: string;
  status?: InvoiceStatus[];
  overdue?: boolean;
  page?: number;
  perPage?: number;
}

export type { Money, Translatable };
