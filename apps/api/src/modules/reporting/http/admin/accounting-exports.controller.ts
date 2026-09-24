import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Page } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import {
  AccountingExportQueries,
  AccountingExportView,
  RequestAccountingExport,
  RetryAccountingExportPush,
} from '../../application/accounting/accounting-export.actions';
import { AccountingExportDto, AccountingExportsPageDto, CreateAccountingExportDto, PageQueryDto } from '../dto';

/**
 * Выгрузка продаж и документов в учёт (1С, этап 3). Файл строится задачей в очереди,
 * статус и ссылка на файл — GET /:id. При настроенном HTTP-сервисе 1С XML отправляется туда.
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reports/accounting-exports')
export class AccountingExportsController {
  constructor(
    private readonly request: RequestAccountingExport,
    private readonly retryPush: RetryAccountingExportPush,
    private readonly queries: AccountingExportQueries,
  ) {}

  @RequirePermissions(Permission.ReportsExport)
  @Post()
  @ApiCreatedResponse({ type: AccountingExportDto })
  create(@CurrentActor() actor: Actor, @Body() dto: CreateAccountingExportDto): Promise<AccountingExportView> {
    return this.request.execute(actor, dto);
  }

  @RequirePermissions(Permission.ReportsExport)
  @Get()
  @ApiOkResponse({ type: AccountingExportsPageDto })
  list(@CurrentActor() actor: Actor, @Query() q: PageQueryDto): Promise<Page<AccountingExportView>> {
    return this.queries.list(actor, q);
  }

  @RequirePermissions(Permission.ReportsExport)
  @Get(':id')
  @ApiOkResponse({ type: AccountingExportDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<AccountingExportView> {
    return this.queries.get(actor, id);
  }

  /** Повторить отправку готового XML в HTTP-сервис 1С. */
  @RequirePermissions(Permission.ReportsExport)
  @Post(':id/push')
  @ApiCreatedResponse({ type: AccountingExportDto })
  push(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<AccountingExportView> {
    return this.retryPush.execute(actor, id);
  }
}
