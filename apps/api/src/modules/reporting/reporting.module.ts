import { Global, Module, OnModuleInit } from '@nestjs/common';
import { IntegrationCatalog } from '../../shared/infrastructure/settings/integration-catalog';
import { AccountingDataCollector } from './application/accounting/accounting-data.collector';
import {
  AccountingExportQueries,
  BuildAccountingExport,
  PushAccountingExport,
  RequestAccountingExport,
  RetryAccountingExportPush,
} from './application/accounting/accounting-export.actions';
import {
  ACCOUNTING_EXPORTERS,
  AccountingExporter,
  AccountingExporterRegistry,
  AccountingPushGateway,
} from './application/accounting/accounting-exporter';
import { AggregatorVolumeQueries, DeleteAggregatorVolume, SaveAggregatorVolume } from './application/aggregator-volume.actions';
import { DailyReportQueries } from './application/daily-reports/daily-report.queries';
import { DailySummaryBuilder } from './application/daily-reports/daily-summary.builder';
import { GenerateDailyReports } from './application/daily-reports/generate-daily-reports.action';
import { RecognizeRefundRevenue } from './application/recognize-refund-revenue.action';
import { ReportScopes } from './application/report-scope';
import { DashboardReport, GoalsReport, KpiCalculator } from './application/reports/dashboard.queries';
import { CancelledOrdersReport, ConversionReport, TopDishesReport } from './application/reports/orders.queries';
import { CashFlowReport, CertificatesReport } from './application/reports/payments.queries';
import { AverageCheckReport, OwnChannelReport, RevenueReport } from './application/reports/sales.queries';
import { BanquetFunnelReport, HallLoadReport } from './application/reports/venues.queries';
import { PurgeStorefrontEvents, RecordStorefrontEvent } from './application/storefront.actions';
import { ReportingBanquetProjection } from './handlers/banquet.handlers';
import { ReportingOrderingProjection } from './handlers/ordering.handlers';
import { ReportingPaymentsProjection } from './handlers/payments.handlers';
import { ReportingJobs } from './handlers/reporting.jobs';
import { ReportingReservationProjection } from './handlers/reservation.handlers';
import { AccountingExportsController } from './http/admin/accounting-exports.controller';
import { AggregatorVolumesController } from './http/admin/aggregator-volumes.controller';
import { DailyReportsController } from './http/admin/daily-reports.controller';
import { ReportsController } from './http/admin/reports.controller';
import { PublicAnalyticsController } from './http/public/analytics.controller';
import { AccountingExportRepository } from './infrastructure/accounting-export.repository';
import { ONEC_HTTP_DESCRIPTOR, OnecHttpPushGateway } from './infrastructure/adapters/onec-http/onec-http.gateway';
import { OnecXmlAccountingExporter } from './infrastructure/adapters/onec-xml/onec-xml.exporter';
import { XlsxAccountingExporter } from './infrastructure/adapters/xlsx/xlsx-accounting.exporter';
import { AggregatorVolumeRepository } from './infrastructure/aggregator-volume.repository';
import { BanquetFactsRepository } from './infrastructure/banquet-facts.repository';
import { CertificateFactsRepository } from './infrastructure/certificate-facts.repository';
import { DailyReportRepository } from './infrastructure/daily-report.repository';
import { OrderFactsRepository } from './infrastructure/order-facts.repository';
import { PaymentFactsRepository } from './infrastructure/payment-facts.repository';
import { ReservationFactsRepository } from './infrastructure/reservation-facts.repository';
import { SalesFactsRepository } from './infrastructure/sales-facts.repository';
import { StorefrontEventsRepository } from './infrastructure/storefront-events.repository';

/**
 * Reporting: только чтение. Собственные проекции из событий Ordering, Payments, Reservation,
 * Banquet (к таблицам других модулей не обращается), отчёты админки с выгрузкой XLSX, аналитика
 * витрины, дневной отчёт в 23:30, выгрузка продаж и документов в учёт (1С). Публичных сервисов
 * для других модулей не предоставляет.
 */
@Global()
@Module({
  controllers: [ReportsController, DailyReportsController, AggregatorVolumesController, AccountingExportsController, PublicAnalyticsController],
  providers: [
    // Проекции и репозитории
    OrderFactsRepository,
    PaymentFactsRepository,
    SalesFactsRepository,
    ReservationFactsRepository,
    BanquetFactsRepository,
    CertificateFactsRepository,
    StorefrontEventsRepository,
    AggregatorVolumeRepository,
    DailyReportRepository,
    AccountingExportRepository,
    // Подписчики на события, задачи и расписания
    ReportingOrderingProjection,
    ReportingPaymentsProjection,
    ReportingReservationProjection,
    ReportingBanquetProjection,
    ReportingJobs,
    // Отчёты (запросы)
    ReportScopes,
    RevenueReport,
    AverageCheckReport,
    OwnChannelReport,
    ConversionReport,
    TopDishesReport,
    CancelledOrdersReport,
    HallLoadReport,
    BanquetFunnelReport,
    CashFlowReport,
    CertificatesReport,
    KpiCalculator,
    DashboardReport,
    GoalsReport,
    DailySummaryBuilder,
    DailyReportQueries,
    AggregatorVolumeQueries,
    AccountingExportQueries,
    AccountingDataCollector,
    // Действия
    RecognizeRefundRevenue,
    RecordStorefrontEvent,
    PurgeStorefrontEvents,
    SaveAggregatorVolume,
    DeleteAggregatorVolume,
    GenerateDailyReports,
    RequestAccountingExport,
    BuildAccountingExport,
    PushAccountingExport,
    RetryAccountingExportPush,
    // Интеграция с учётом (1С): форматы файла и отправка — адаптеры за интерфейсами
    OnecXmlAccountingExporter,
    XlsxAccountingExporter,
    {
      provide: ACCOUNTING_EXPORTERS,
      useFactory: (xml: OnecXmlAccountingExporter, xlsx: XlsxAccountingExporter): AccountingExporter[] => [xml, xlsx],
      inject: [OnecXmlAccountingExporter, XlsxAccountingExporter],
    },
    AccountingExporterRegistry,
    { provide: AccountingPushGateway, useClass: OnecHttpPushGateway },
  ],
  exports: [],
})
export class ReportingModule implements OnModuleInit {
  constructor(private readonly catalog: IntegrationCatalog) {}

  onModuleInit(): void {
    this.catalog.register(ONEC_HTTP_DESCRIPTOR);
  }
}
