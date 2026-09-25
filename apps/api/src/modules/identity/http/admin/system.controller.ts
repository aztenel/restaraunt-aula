import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditLog } from '../../../../shared/infrastructure/audit/audit-log';
import { FailedJobsService } from '../../../../shared/infrastructure/events/failed-jobs.service';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { IntegrationLog } from '../../../../shared/infrastructure/integrations/integration-log';
import { IntegrationCatalog, IntegrationDescriptor } from '../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../shared/infrastructure/settings/integration-settings';
import { Actor } from '../../../../shared/kernel/actor';
import { ValidationError } from '../../../../shared/kernel/errors';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { Database } from '../../../../shared/infrastructure/database/database';
import {
  AuditPageDto,
  FailedJobsPageDto,
  IntegrationDescriptorDto,
  IntegrationLogsPageDto,
  IntegrationSettingDto,
  SaveIntegrationSettingDto,
} from '../dto';

function parseDate(value: string | undefined, field: string): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError('request.invalid_date', `Invalid ${field}`);
  return d;
}

@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/system')
export class SystemController {
  constructor(
    private readonly audit: AuditLog,
    private readonly failedJobs: FailedJobsService,
    private readonly integrationLog: IntegrationLog,
    private readonly settings: IntegrationSettings,
    private readonly catalog: IntegrationCatalog,
    private readonly database: Database,
  ) {}

  /** Журнал действий пользователей с фильтрами. */
  @RequirePermissions(Permission.AuditView)
  @Get('audit-log')
  @ApiOkResponse({ type: AuditPageDto })
  @ApiQuery({ name: 'actorUserId', required: false })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'branchId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'perPage', required: false })
  auditLog(
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('branchId') branchId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AuditPageDto> {
    return this.audit.search(
      { actorUserId, action, entityType, entityId, branchId, from: parseDate(from, 'from'), to: parseDate(to, 'to') },
      pageRequest(Number(page) || 1, Number(perPage) || 50),
    );
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Get('integrations/catalog')
  @ApiOkResponse({ type: [IntegrationDescriptorDto] })
  integrationCatalog(): IntegrationDescriptor[] {
    return this.catalog.list();
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Get('integrations')
  @ApiOkResponse({ type: [IntegrationSettingDto] })
  integrations(): Promise<IntegrationSettingDto[]> {
    return this.settings.list();
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Put('integrations/:key')
  @HttpCode(204)
  async saveIntegration(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() dto: SaveIntegrationSettingDto): Promise<void> {
    actor.assertCan(Permission.IntegrationsManage);
    await this.database.transaction(async () => {
      const before = (await this.settings.list()).find((s) => s.key === key) ?? null;
      await this.settings.set(key, dto, actor.userId);
      await this.audit.record({
        action: 'integration.settings_changed',
        entityType: 'integration',
        entityId: key,
        before: before ? { enabled: before.enabled, config: before.config, secrets: Object.keys(before.secrets) } : null,
        after: { enabled: dto.enabled, config: dto.config, secretsChanged: Object.keys(dto.secrets ?? {}) },
      });
    });
  }

  @RequirePermissions(Permission.IntegrationsManage)
  @Get('integration-logs')
  @ApiOkResponse({ type: IntegrationLogsPageDto })
  @ApiQuery({ name: 'integration', required: false })
  @ApiQuery({ name: 'correlationId', required: false })
  @ApiQuery({ name: 'success', required: false })
  @ApiQuery({ name: 'page', required: false })
  integrationLogs(
    @Query('integration') integration?: string,
    @Query('correlationId') correlationId?: string,
    @Query('success') success?: string,
    @Query('page') page?: string,
  ) {
    return this.integrationLog.search(
      { integration, correlationId, success: success === undefined ? undefined : success === 'true' },
      pageRequest(Number(page) || 1, 50),
    );
  }

  /** Очередь неудач: задачи, исчерпавшие лимит повторов. */
  @RequirePermissions(Permission.SystemJobs)
  @Get('failed-jobs')
  @ApiOkResponse({ type: FailedJobsPageDto })
  @ApiQuery({ name: 'open', required: false })
  @ApiQuery({ name: 'page', required: false })
  failed(@Query('open') open?: string, @Query('page') page?: string) {
    return this.failedJobs.list({ open: open !== 'false' }, pageRequest(Number(page) || 1, 50));
  }

  @RequirePermissions(Permission.SystemJobs)
  @Post('failed-jobs/:id/retry')
  @HttpCode(204)
  async retry(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.database.transaction(async () => {
      await this.failedJobs.retry(id, actor.userId);
      await this.audit.record({ action: 'system.failed_job_retried', entityType: 'failed_job', entityId: id });
    });
  }

  @RequirePermissions(Permission.SystemJobs)
  @Post('failed-jobs/:id/resolve')
  @HttpCode(204)
  async resolve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.database.transaction(async () => {
      await this.failedJobs.resolve(id, actor.userId);
      await this.audit.record({ action: 'system.failed_job_resolved', entityType: 'failed_job', entityId: id });
    });
  }
}
