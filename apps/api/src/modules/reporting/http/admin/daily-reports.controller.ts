import { Controller, Get, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Page } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { DailyReportQueries, DailyReportView } from '../../application/daily-reports/daily-report.queries';
import { XLSX_CONTENT_TYPE } from '../../application/reports/report-sheets';
import { DailyReportDto, DailyReportQueryDto, DailyReportsPageDto, PagedReportQueryDto } from '../dto';
import { xlsxFile } from './reports.controller';

/**
 * Дневной отчёт: формируется автоматически в 23:30 (Asia/Almaty), хранится с XLSX.
 * До формирования показываются текущие данные дня (isFinal=false).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reports/daily')
export class DailyReportsController {
  constructor(private readonly queries: DailyReportQueries) {}

  @RequirePermissions(Permission.ReportsBranch, Permission.ReportsConsolidated)
  @Get()
  @ApiOkResponse({ type: DailyReportDto })
  get(@CurrentActor() actor: Actor, @Query() q: DailyReportQueryDto): Promise<DailyReportView> {
    return this.queries.get(actor, q);
  }

  @RequirePermissions(Permission.ReportsBranch, Permission.ReportsConsolidated)
  @Get('export')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ description: 'Файл XLSX', schema: { type: 'string', format: 'binary' } })
  async export(@CurrentActor() actor: Actor, @Query() q: DailyReportQueryDto): Promise<StreamableFile> {
    const file = await this.queries.file(actor, q);
    return xlsxFile(file.body, file.fileName);
  }

  /** История сохранённых дневных отчётов. */
  @RequirePermissions(Permission.ReportsBranch, Permission.ReportsConsolidated)
  @Get('history')
  @ApiOkResponse({ type: DailyReportsPageDto })
  history(@CurrentActor() actor: Actor, @Query() q: PagedReportQueryDto): Promise<Page<DailyReportView>> {
    return this.queries.list(actor, q);
  }
}
