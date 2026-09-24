import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { XlsxBuilder, XlsxSheet } from '../../../../shared/infrastructure/xlsx/xlsx-builder';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { DashboardReport, DashboardView, GoalsReport, GoalsReportView } from '../../application/reports/dashboard.queries';
import {
  CancelledOrdersReport,
  CancelledOrdersReportView,
  ConversionReport,
  ConversionReportView,
  TopDishesReport,
  TopDishesReportView,
} from '../../application/reports/orders.queries';
import { CashFlowReport, CashFlowReportView, CertificatesReport, CertificatesReportView } from '../../application/reports/payments.queries';
import {
  averageCheckSheets,
  banquetFunnelSheets,
  cancelledOrdersSheets,
  cashFlowSheets,
  certificatesSheets,
  conversionSheets,
  dashboardSheets,
  goalsSheets,
  hallLoadSheets,
  ownChannelSheets,
  revenueSheets,
  topDishesSheets,
  XLSX_CONTENT_TYPE,
} from '../../application/reports/report-sheets';
import {
  AverageCheckReport,
  AverageCheckReportView,
  OwnChannelReport,
  OwnChannelReportView,
  RevenueReport,
  RevenueReportView,
} from '../../application/reports/sales.queries';
import { BanquetFunnelReport, BanquetFunnelReportView, HallLoadReport, HallLoadReportView } from '../../application/reports/venues.queries';
import {
  AverageCheckReportDto,
  BanquetFunnelReportDto,
  BranchQueryDto,
  CancelledOrdersReportDto,
  CashFlowReportDto,
  CertificatesReportDto,
  ConversionReportDto,
  DashboardDto,
  GoalsReportDto,
  HallLoadReportDto,
  OwnChannelReportDto,
  PagedReportQueryDto,
  ReportQueryDto,
  RevenueReportDto,
  TopDishesQueryDto,
  TopDishesReportDto,
} from '../dto';

/** Доступ к разделу «Отчёты»: отчёты филиала или сводные (проверка филиала — в запросе отчёта). */
const Reports = () => RequirePermissions(Permission.ReportsBranch, Permission.ReportsConsolidated);
const XlsxResponse = () => ApiOkResponse({ description: 'Файл XLSX', schema: { type: 'string', format: 'binary' } });

export function xlsxFile(body: Buffer, fileName: string): StreamableFile {
  return new StreamableFile(body, { type: XLSX_CONTENT_TYPE, disposition: `attachment; filename="${fileName}"`, length: body.length });
}

function fileName(report: string, h: { from?: string; to?: string; branchId: string | null }): string {
  const period = h.from && h.to ? `_${h.from}_${h.to}` : '';
  return `aula_${report}${period}${h.branchId ? `_${h.branchId.slice(-8)}` : '_all'}.xlsx`;
}

/**
 * Отчёты админки (ТЗ, раздел 7): выручка по дням и каналам, средний чек, конверсия витрины,
 * топ блюд, загрузка залов, воронка банкетов, отменённые заказы, движение денег, сертификаты,
 * панель показателей, доля своего канала, цели ТЗ. Каждый — JSON и выгрузка XLSX (/export).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reports')
export class ReportsController {
  constructor(
    private readonly revenue: RevenueReport,
    private readonly averageCheck: AverageCheckReport,
    private readonly conversion: ConversionReport,
    private readonly topDishes: TopDishesReport,
    private readonly hallLoad: HallLoadReport,
    private readonly banquetFunnel: BanquetFunnelReport,
    private readonly cancelledOrders: CancelledOrdersReport,
    private readonly cashFlow: CashFlowReport,
    private readonly certificates: CertificatesReport,
    private readonly dashboard: DashboardReport,
    private readonly ownChannel: OwnChannelReport,
    private readonly goals: GoalsReport,
    private readonly xlsx: XlsxBuilder,
  ) {}

  private async export<V extends { branchId: string | null }>(report: string, view: V, sheets: (v: V) => XlsxSheet<any>[]): Promise<StreamableFile> {
    return xlsxFile(await this.xlsx.build(sheets(view)), fileName(report, view));
  }

  @Reports()
  @Get('revenue')
  @ApiOkResponse({ type: RevenueReportDto })
  revenueReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<RevenueReportView> {
    return this.revenue.execute(actor, q);
  }

  @Reports()
  @Get('revenue/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async revenueExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('revenue', await this.revenue.execute(actor, q), revenueSheets);
  }

  @Reports()
  @Get('average-check')
  @ApiOkResponse({ type: AverageCheckReportDto })
  averageCheckReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<AverageCheckReportView> {
    return this.averageCheck.execute(actor, q);
  }

  @Reports()
  @Get('average-check/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async averageCheckExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('average_check', await this.averageCheck.execute(actor, q), averageCheckSheets);
  }

  @Reports()
  @Get('conversion')
  @ApiOkResponse({ type: ConversionReportDto })
  conversionReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<ConversionReportView> {
    return this.conversion.execute(actor, q);
  }

  @Reports()
  @Get('conversion/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async conversionExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('conversion', await this.conversion.execute(actor, q), conversionSheets);
  }

  @Reports()
  @Get('top-dishes')
  @ApiOkResponse({ type: TopDishesReportDto })
  topDishesReport(@CurrentActor() actor: Actor, @Query() q: TopDishesQueryDto): Promise<TopDishesReportView> {
    return this.topDishes.execute(actor, q);
  }

  @Reports()
  @Get('top-dishes/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async topDishesExport(@CurrentActor() actor: Actor, @Query() q: TopDishesQueryDto): Promise<StreamableFile> {
    return this.export('top_dishes', await this.topDishes.execute(actor, q), topDishesSheets);
  }

  @Reports()
  @Get('hall-load')
  @ApiOkResponse({ type: HallLoadReportDto })
  hallLoadReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<HallLoadReportView> {
    return this.hallLoad.execute(actor, q);
  }

  @Reports()
  @Get('hall-load/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async hallLoadExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('hall_load', await this.hallLoad.execute(actor, q), hallLoadSheets);
  }

  @Reports()
  @Get('banquet-funnel')
  @ApiOkResponse({ type: BanquetFunnelReportDto })
  banquetFunnelReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<BanquetFunnelReportView> {
    return this.banquetFunnel.execute(actor, q);
  }

  @Reports()
  @Get('banquet-funnel/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async banquetFunnelExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('banquet_funnel', await this.banquetFunnel.execute(actor, q), banquetFunnelSheets);
  }

  @Reports()
  @Get('cancelled-orders')
  @ApiOkResponse({ type: CancelledOrdersReportDto })
  cancelledOrdersReport(@CurrentActor() actor: Actor, @Query() q: PagedReportQueryDto): Promise<CancelledOrdersReportView> {
    return this.cancelledOrders.execute(actor, q);
  }

  @Reports()
  @Get('cancelled-orders/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async cancelledOrdersExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    // Выгрузка — все отменённые заказы периода (до 10 000 строк).
    return this.export('cancelled_orders', await this.cancelledOrders.executeForExport(actor, q), cancelledOrdersSheets);
  }

  @Reports()
  @Get('payments')
  @ApiOkResponse({ type: CashFlowReportDto })
  cashFlowReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<CashFlowReportView> {
    return this.cashFlow.execute(actor, q);
  }

  @Reports()
  @Get('payments/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async cashFlowExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('payments', await this.cashFlow.execute(actor, q), cashFlowSheets);
  }

  @Reports()
  @Get('certificates')
  @ApiOkResponse({ type: CertificatesReportDto })
  certificatesReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<CertificatesReportView> {
    return this.certificates.execute(actor, q);
  }

  @Reports()
  @Get('certificates/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async certificatesExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('certificates', await this.certificates.execute(actor, q), certificatesSheets);
  }

  @Reports()
  @Get('dashboard')
  @ApiOkResponse({ type: DashboardDto })
  dashboardReport(@CurrentActor() actor: Actor, @Query() q: BranchQueryDto): Promise<DashboardView> {
    return this.dashboard.execute(actor, q);
  }

  @Reports()
  @Get('dashboard/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async dashboardExport(@CurrentActor() actor: Actor, @Query() q: BranchQueryDto): Promise<StreamableFile> {
    return this.export('dashboard', await this.dashboard.execute(actor, q), dashboardSheets);
  }

  @Reports()
  @Get('own-channel')
  @ApiOkResponse({ type: OwnChannelReportDto })
  ownChannelReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<OwnChannelReportView> {
    return this.ownChannel.execute(actor, q);
  }

  @Reports()
  @Get('own-channel/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async ownChannelExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('own_channel', await this.ownChannel.execute(actor, q), ownChannelSheets);
  }

  @Reports()
  @Get('goals')
  @ApiOkResponse({ type: GoalsReportDto })
  goalsReport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<GoalsReportView> {
    return this.goals.execute(actor, q);
  }

  @Reports()
  @Get('goals/export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @XlsxResponse()
  async goalsExport(@CurrentActor() actor: Actor, @Query() q: ReportQueryDto): Promise<StreamableFile> {
    return this.export('goals', await this.goals.execute(actor, q), goalsSheets);
  }
}
