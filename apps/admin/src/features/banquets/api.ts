/**
 * Эндпоинты банкетов в админке (модуль Banquet: /api/v1/admin/banquets/*). Возвращают данные или бросают ApiError.
 *
 * Ключи заявок, счетов, календаря и SLA начинаются с 'banquets' — их инвалидирует лента событий
 * (useAdminFeed, поток 'banquets'). Справочники (блюда меню, компании, шаблоны) — под 'banquets-ref',
 * чтобы новые заявки их не перезапрашивали.
 */
import { call, type Page, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type {
  BankTransferInput,
  BankTransferResult,
  BanquetAct,
  BanquetCalendar,
  BanquetDocument,
  BanquetManager,
  BanquetRequestDetail,
  BanquetRequestSummary,
  BanquetStatus,
  ClientCompany,
  CompanyInput,
  ContractTemplate,
  CreateRequestInput,
  DishOption,
  InvoiceListItem,
  InvoiceListQuery,
  IssueInvoiceInput,
  ManualActivityKind,
  MoneyInput,
  PipelineColumn,
  PipelineQuery,
  Quote,
  QuoteSummary,
  RefundInput,
  RefundResult,
  RequestListQuery,
  SaveQuoteInput,
  SetVenueInput,
  SignedLink,
  SlaStats,
  TemplateInput,
  TemplatePlaceholder,
  UpdateRequestInput,
} from './types';

function body<T>(value: unknown): T {
  return value as T;
}

function csv(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values.join(',') : undefined;
}

function text(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

export const banquetsKeys = {
  all: ['banquets'] as const,
  pipeline: (params: PipelineQuery) => ['banquets', 'pipeline', params] as const,
  list: (params: RequestListQuery) => ['banquets', 'list', params] as const,
  /** Доска из списка (поиск / «SLA нарушен»): другая форма данных, чем у списка. */
  boardList: (params: RequestListQuery) => ['banquets', 'board-list', params] as const,
  detail: (id: string) => ['banquets', 'detail', id] as const,
  quote: (quoteId: string) => ['banquets', 'quote', quoteId] as const,
  managers: ['banquets', 'managers'] as const,
  calendar: (params: { branchId: string; from: string; to: string }) => ['banquets', 'calendar', params] as const,
  sla: (params: { from: string; to: string; branchId?: string }) => ['banquets', 'sla', params] as const,
  invoices: (params: InvoiceListQuery) => ['banquets', 'invoices', params] as const,
  invoice: (id: string) => ['banquets', 'invoice', id] as const,
};

export const banquetRefKeys = {
  all: ['banquets-ref'] as const,
  dishes: (branchId: string, q: string) => ['banquets-ref', 'dishes', branchId, q] as const,
  companies: ['banquets-ref', 'companies'] as const,
  companyList: (params: { q?: string; page?: number; perPage?: number }) => ['banquets-ref', 'companies', 'list', params] as const,
  company: (id: string) => ['banquets-ref', 'companies', 'detail', id] as const,
  templates: ['banquets-ref', 'templates'] as const,
  placeholders: ['banquets-ref', 'placeholders'] as const,
};

export const banquetsApi = {
  // ---------------------------------------------------------------- заявки
  pipeline: (params: PipelineQuery): Promise<PipelineColumn[]> =>
    call(api.GET('/api/v1/admin/banquets/pipeline', { params: { query: params } })),
  list: (params: RequestListQuery): Promise<Page<BanquetRequestSummary>> =>
    call(
      api.GET('/api/v1/admin/banquets/requests', {
        params: {
          query: {
            status: csv(params.status),
            managerId: params.managerId,
            branchId: params.branchId,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            q: text(params.q),
            offsite: params.offsite,
            slaBreached: params.slaBreached,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    ),
  get: (id: string): Promise<BanquetRequestDetail> => call(api.GET('/api/v1/admin/banquets/requests/{id}', { params: { path: { id } } })),
  create: (input: CreateRequestInput): Promise<BanquetRequestDetail> => call(api.POST('/api/v1/admin/banquets/requests', { body: input })),
  update: (id: string, input: UpdateRequestInput): Promise<BanquetRequestDetail> =>
    call(api.PATCH('/api/v1/admin/banquets/requests/{id}', { params: { path: { id } }, body: body<Schemas['BanquetUpdateRequestDto']>(input) })),
  transition: (id: string, to: BanquetStatus, reason?: string): Promise<BanquetRequestDetail> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/transition', { params: { path: { id } }, body: { to, reason: text(reason) } })),
  assign: (id: string, managerId: string): Promise<BanquetRequestDetail> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/assign', { params: { path: { id } }, body: { managerId } })),
  addActivity: (id: string, kind: ManualActivityKind, activityText?: string): Promise<{ id: string }> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/activities', { params: { path: { id } }, body: { kind, text: text(activityText) } })),
  setVenue: (id: string, input: SetVenueInput): Promise<BanquetRequestDetail> =>
    call(api.PUT('/api/v1/admin/banquets/requests/{id}/venue', { params: { path: { id } }, body: input })),
  releaseVenue: (id: string): Promise<BanquetRequestDetail> =>
    call(api.DELETE('/api/v1/admin/banquets/requests/{id}/venue', { params: { path: { id } } })),
  /** null — предоплата по умолчанию (50% итога согласованной сметы). */
  setPrepayment: (id: string, amount: MoneyInput | null): Promise<BanquetRequestDetail> =>
    call(api.PUT('/api/v1/admin/banquets/requests/{id}/prepayment', { params: { path: { id } }, body: { amount } })),
  refund: (id: string, input: RefundInput): Promise<RefundResult> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/refunds', { params: { path: { id } }, body: input })),
  managers: (): Promise<BanquetManager[]> => call(api.GET('/api/v1/admin/banquets/managers')),
  calendar: (params: { branchId: string; from: string; to: string }): Promise<BanquetCalendar> =>
    call(api.GET('/api/v1/admin/banquets/calendar', { params: { query: params } })),
  sla: (params: { from: string; to: string; branchId?: string }): Promise<SlaStats> =>
    call(api.GET('/api/v1/admin/banquets/sla-stats', { params: { query: params } })),

  // ---------------------------------------------------------------- сметы
  quotes: (id: string): Promise<QuoteSummary[]> => call(api.GET('/api/v1/admin/banquets/requests/{id}/quotes', { params: { path: { id } } })),
  /** Сохранить смету — всегда новая версия; итоги считает сервер. */
  saveQuote: (id: string, input: SaveQuoteInput): Promise<Quote> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/quotes', { params: { path: { id } }, body: body<Schemas['BanquetSaveQuoteDto']>(input) })),
  quote: (quoteId: string): Promise<Quote> => call(api.GET('/api/v1/admin/banquets/quotes/{quoteId}', { params: { path: { quoteId } } })),
  quotePdf: (quoteId: string): Promise<SignedLink> =>
    call(api.GET('/api/v1/admin/banquets/quotes/{quoteId}/pdf', { params: { path: { quoteId } } })),
  sendQuote: (quoteId: string): Promise<BanquetRequestDetail> =>
    call(api.POST('/api/v1/admin/banquets/quotes/{quoteId}/send', { params: { path: { quoteId } } })),
  dishes: (branchId: string, q: string, limit = 20): Promise<DishOption[]> =>
    call(api.GET('/api/v1/admin/banquets/menu/dishes', { params: { query: { branchId, q, limit } } })),

  // ---------------------------------------------------------------- счета
  invoices: (params: InvoiceListQuery): Promise<Page<InvoiceListItem>> =>
    call(
      api.GET('/api/v1/admin/banquets/invoices', {
        params: {
          query: {
            branchId: params.branchId,
            status: csv(params.status),
            overdue: params.overdue ? true : undefined,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    ),
  invoice: (invoiceId: string): Promise<InvoiceListItem> =>
    call(api.GET('/api/v1/admin/banquets/invoices/{invoiceId}', { params: { path: { invoiceId } } })),
  issueInvoice: (id: string, input: IssueInvoiceInput): Promise<InvoiceListItem> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/invoices', { params: { path: { id } }, body: input })),
  invoicePdf: (invoiceId: string): Promise<SignedLink> =>
    call(api.GET('/api/v1/admin/banquets/invoices/{invoiceId}/pdf', { params: { path: { invoiceId } } })),
  registerBankTransfer: (invoiceId: string, input: BankTransferInput): Promise<BankTransferResult> =>
    call(api.POST('/api/v1/admin/banquets/invoices/{invoiceId}/payments', { params: { path: { invoiceId } }, body: input })),
  cancelInvoice: (invoiceId: string, reason?: string): Promise<InvoiceListItem> =>
    call(api.POST('/api/v1/admin/banquets/invoices/{invoiceId}/cancel', { params: { path: { invoiceId } }, body: { reason: text(reason) } })),

  // ---------------------------------------------------------------- документы
  documents: (id: string): Promise<BanquetDocument[]> =>
    call(api.GET('/api/v1/admin/banquets/requests/{id}/documents', { params: { path: { id } } })),
  documentLink: (documentId: string): Promise<SignedLink> =>
    call(api.GET('/api/v1/admin/banquets/documents/{documentId}/link', { params: { path: { documentId } } })),
  generateContract: (id: string, templateId?: string | null): Promise<BanquetDocument> =>
    call(api.POST('/api/v1/admin/banquets/requests/{id}/contract', { params: { path: { id } }, body: { templateId: templateId ?? undefined } })),
  issueAct: (id: string): Promise<BanquetAct> => call(api.POST('/api/v1/admin/banquets/requests/{id}/act', { params: { path: { id } } })),
  retryEsf: (actId: string): Promise<BanquetAct> => call(api.POST('/api/v1/admin/banquets/acts/{actId}/esf/retry', { params: { path: { actId } } })),

  // ---------------------------------------------------------------- компании и шаблоны
  companies: (params: { q?: string; page?: number; perPage?: number }): Promise<Page<ClientCompany>> =>
    call(api.GET('/api/v1/admin/banquets/companies', { params: { query: { q: text(params.q), page: params.page, perPage: params.perPage } } })),
  company: (id: string): Promise<ClientCompany> => call(api.GET('/api/v1/admin/banquets/companies/{id}', { params: { path: { id } } })),
  createCompany: (input: CompanyInput): Promise<ClientCompany> => call(api.POST('/api/v1/admin/banquets/companies', { body: input })),
  updateCompany: (id: string, input: CompanyInput): Promise<ClientCompany> =>
    call(api.PUT('/api/v1/admin/banquets/companies/{id}', { params: { path: { id } }, body: input })),
  deleteCompany: (id: string): Promise<unknown> => call(api.DELETE('/api/v1/admin/banquets/companies/{id}', { params: { path: { id } } })),
  templates: (): Promise<ContractTemplate[]> => call(api.GET('/api/v1/admin/banquets/contract-templates')),
  placeholders: (): Promise<TemplatePlaceholder[]> => call(api.GET('/api/v1/admin/banquets/contract-templates/placeholders')),
  createTemplate: (input: TemplateInput): Promise<ContractTemplate> => call(api.POST('/api/v1/admin/banquets/contract-templates', { body: input })),
  updateTemplate: (id: string, input: TemplateInput): Promise<ContractTemplate> =>
    call(api.PUT('/api/v1/admin/banquets/contract-templates/{id}', { params: { path: { id } }, body: input })),
  deleteTemplate: (id: string): Promise<unknown> =>
    call(api.DELETE('/api/v1/admin/banquets/contract-templates/{id}', { params: { path: { id } } })),
};

/** Открыть файл по подписанной ссылке (PDF сметы/счёта, документ) в новой вкладке. */
export async function openSignedLink(load: () => Promise<SignedLink>): Promise<void> {
  // Окно открывается сразу (в обработчике клика), иначе браузер заблокирует всплывающее окно.
  const win = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null;
  try {
    const link = await load();
    if (win) win.location.href = link.url;
    else window.location.assign(link.url);
  } catch (error) {
    win?.close();
    throw error;
  }
}
