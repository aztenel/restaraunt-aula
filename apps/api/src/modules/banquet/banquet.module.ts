import { Global, Module, OnModuleInit } from '@nestjs/common';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { CompanyQueries, DocumentQueries, InvoiceQueries, QuoteQueries, TemplateQueries } from './application/admin.queries';
import { AnonymizeBanquetContacts } from './application/anonymize.action';
import { BanquetLinks } from './application/banquet-links';
import { BanquetSupport } from './application/banquet-support';
import { BanquetQueries } from './application/banquet.queries';
import { CreateClientCompany, DeleteClientCompany, UpdateClientCompany } from './application/company.actions';
import { CreateBanquetRequest } from './application/create-request.action';
import { GenerateContract, IssueBanquetAct } from './application/document.actions';
import { BanquetDocumentFiles } from './application/document-files';
import { ESF_GATEWAYS, EsfGatewayRegistry } from './application/esf-gateway.registry';
import { CheckEsfStatus, RetryEsf, SubmitEsf } from './application/esf.actions';
import { BanquetFunnel } from './application/funnel';
import {
  CancelBanquetInvoice,
  IssueBanquetInvoice,
  RecordInvoicePayment,
  RecordInvoiceRefund,
  RefundBanquetPayment,
  RegisterInvoiceBankTransfer,
  RenewInvoicePayment,
} from './application/invoice.actions';
import { ManagerAssigner } from './application/manager-assigner';
import { PublicBanquetQueries } from './application/public.queries';
import { AcceptQuote, SaveQuoteVersion, SendQuote } from './application/quote.actions';
import {
  AddBanquetActivity,
  AssignBanquetManager,
  CancelBanquetRequest,
  SetPrepaymentAmount,
  TransitionBanquetRequest,
  UpdateBanquetRequest,
} from './application/request.actions';
import { CheckSlaBreaches } from './application/sla.actions';
import { BanquetStatusRecorder } from './application/status-recorder';
import { DeleteContractTemplate, SaveContractTemplate } from './application/template.actions';
import { ReleaseBanquetVenue, SetBanquetVenue } from './application/venue.actions';
import { EsfGateway } from './domain/esf';
import { BanquetCustomerHandlers, BanquetPaymentHandlers } from './handlers/banquet-events.handlers';
import { BanquetJobHandlers, BanquetSchedules } from './handlers/banquet-jobs.handlers';
import { AdminBanquetCompaniesController } from './http/admin/companies.controller';
import { AdminBanquetDocumentsController } from './http/admin/documents.controller';
import { AdminBanquetInvoicesController } from './http/admin/invoices.controller';
import { AdminBanquetQuotesController } from './http/admin/quotes.controller';
import { AdminBanquetRequestsController } from './http/admin/requests.controller';
import { AdminBanquetTemplatesController } from './http/admin/templates.controller';
import { PublicBanquetsController } from './http/public/banquets.controller';
import { ActivityRepository } from './infrastructure/activity.repository';
import { ISESF_INTEGRATION } from './infrastructure/adapters/isesf/isesf.settings';
import { IsEsfGateway } from './infrastructure/adapters/isesf/isesf.gateway';
import { MANUAL_ESF_INTEGRATION, ManualEsfGateway } from './infrastructure/adapters/manual/manual-esf.gateway';
import { CompanyRepository } from './infrastructure/company.repository';
import { DocumentRepository } from './infrastructure/document.repository';
import { InvoiceRepository } from './infrastructure/invoice.repository';
import { QuoteRepository } from './infrastructure/quote.repository';
import { RequestRepository } from './infrastructure/request.repository';
import { TemplateRepository } from './infrastructure/template.repository';

/**
 * Banquet: банкеты и кейтеринг — заявки и воронка (автоназначение менеджеру, SLA 30 минут), залы через
 * модуль Reservation, сметы с версиями и PDF, предоплата и счета (онлайн-оплата физлицу, счёт юрлицу,
 * безнал), договор по шаблону, акт выполненных работ, ЭСФ (адаптеры manual — по умолчанию, isesf — API ИС ЭСФ).
 * Публичных сервисов не предоставляет — только события BanquetEvents (отчётность, база гостей).
 */
@Global()
@Module({
  controllers: [
    AdminBanquetRequestsController,
    AdminBanquetQuotesController,
    AdminBanquetInvoicesController,
    AdminBanquetDocumentsController,
    AdminBanquetCompaniesController,
    AdminBanquetTemplatesController,
    PublicBanquetsController,
  ],
  providers: [
    // Хранилище
    RequestRepository,
    ActivityRepository,
    QuoteRepository,
    InvoiceRepository,
    DocumentRepository,
    CompanyRepository,
    TemplateRepository,
    // Адаптеры ЭСФ: порядок — приоритет (API ИС ЭСФ, если включён; иначе черновик XML — по умолчанию)
    ManualEsfGateway,
    IsEsfGateway,
    {
      provide: ESF_GATEWAYS,
      useFactory: (isesf: IsEsfGateway, manual: ManualEsfGateway): EsfGateway[] => [isesf, manual],
      inject: [IsEsfGateway, ManualEsfGateway],
    },
    EsfGatewayRegistry,
    // Общие службы
    BanquetLinks,
    BanquetSupport,
    ManagerAssigner,
    BanquetStatusRecorder,
    BanquetFunnel,
    BanquetDocumentFiles,
    // Действия
    CreateBanquetRequest,
    UpdateBanquetRequest,
    TransitionBanquetRequest,
    CancelBanquetRequest,
    AssignBanquetManager,
    AddBanquetActivity,
    SetPrepaymentAmount,
    SetBanquetVenue,
    ReleaseBanquetVenue,
    SaveQuoteVersion,
    SendQuote,
    AcceptQuote,
    IssueBanquetInvoice,
    RecordInvoicePayment,
    RegisterInvoiceBankTransfer,
    CancelBanquetInvoice,
    RenewInvoicePayment,
    RefundBanquetPayment,
    RecordInvoiceRefund,
    GenerateContract,
    IssueBanquetAct,
    SubmitEsf,
    CheckEsfStatus,
    RetryEsf,
    CreateClientCompany,
    UpdateClientCompany,
    DeleteClientCompany,
    SaveContractTemplate,
    DeleteContractTemplate,
    CheckSlaBreaches,
    AnonymizeBanquetContacts,
    // Запросы
    BanquetQueries,
    QuoteQueries,
    InvoiceQueries,
    DocumentQueries,
    CompanyQueries,
    TemplateQueries,
    PublicBanquetQueries,
    // Подписки, задачи, расписания
    BanquetPaymentHandlers,
    BanquetCustomerHandlers,
    BanquetJobHandlers,
    BanquetSchedules,
  ],
  exports: [],
})
export class BanquetModule implements OnModuleInit {
  constructor(private readonly catalog: IntegrationCatalog) {}

  onModuleInit(): void {
    this.catalog.register(MANUAL_ESF_INTEGRATION);
    this.catalog.register(ISESF_INTEGRATION);
  }
}
