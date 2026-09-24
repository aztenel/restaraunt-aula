import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { RecordStaffConsent } from '../../application/consent.actions';
import { AnonymizeCustomer, UpdateCustomerProfile } from '../../application/customer-profile.actions';
import { CustomerQueries } from '../../application/customers.queries';
import { ExportCustomers } from '../../application/export-customers.action';
import {
  AnonymizeCustomerDto,
  CustomerDetailDto,
  CustomerDetailQueryDto,
  CustomerDto,
  CustomersPageDto,
  CustomersQueryDto,
  ExportCustomersDto,
  RecordConsentDto,
  TagStatDto,
  UpdateCustomerDto,
} from '../dto';

/**
 * База гостей в админке. Гости общие для сети: доступ — право customers.view хотя бы в одном филиале;
 * правка — customers.manage; выгрузка — customers.export (каждая выгрузка пишется в журнал).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(
    private readonly queries: CustomerQueries,
    private readonly updateProfile: UpdateCustomerProfile,
    private readonly recordConsent: RecordStaffConsent,
    private readonly anonymizeCustomer: AnonymizeCustomer,
    private readonly exportCustomers: ExportCustomers,
  ) {}

  @Get()
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: CustomersPageDto })
  list(@CurrentActor() actor: Actor, @Query() query: CustomersQueryDto): Promise<CustomersPageDto> {
    return this.queries.list(
      actor,
      {
        filter: {
          q: query.q,
          tags: query.tag ? query.tag.split(',') : undefined,
          spentMin: query.spentMin,
          spentMax: query.spentMax,
          lastActivityFrom: query.lastActivityFrom,
          lastActivityTo: query.lastActivityTo,
          branchId: query.branchId,
          hasBanquet: query.hasBanquet,
          marketingConsent: query.marketingConsent,
        },
        segmentId: query.segmentId,
        sort: query.sort,
        order: query.order,
        includeAnonymized: query.includeAnonymized,
      },
      pageRequest(query.page, query.perPage),
    );
  }

  @Get('tags')
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: [TagStatDto] })
  tags(@CurrentActor() actor: Actor): Promise<TagStatDto[]> {
    return this.queries.tags(actor);
  }

  /** Выгрузка по фильтру или сегменту: XLSX или CSV (файл в ответе). */
  @Post('export')
  @HttpCode(200)
  @RequirePermissions(Permission.CustomersExport)
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv')
  @ApiOkResponse({ description: 'Файл выгрузки; число строк — в заголовке X-Export-Count', schema: { type: 'string', format: 'binary' } })
  async export(
    @CurrentActor() actor: Actor,
    @Body() dto: ExportCustomersDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.exportCustomers.execute(actor, { ...dto, filter: dto.filter ? { ...dto.filter } : undefined });
    res.setHeader('x-export-count', String(file.count));
    return new StreamableFile(file.body, {
      type: file.contentType,
      disposition: `attachment; filename="${file.filename}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      length: file.body.length,
    });
  }

  @Get(':id')
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: CustomerDetailDto })
  detail(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CustomerDetailQueryDto,
  ): Promise<CustomerDetailDto> {
    return this.queries.detail(actor, id, { from: query.from, to: query.to }, pageRequest(query.page, query.perPage));
  }

  @Patch(':id')
  @RequirePermissions(Permission.CustomersManage)
  @ApiOkResponse({ type: CustomerDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCustomerDto): Promise<CustomerDto> {
    return this.updateProfile.execute(actor, id, dto);
  }

  /** Согласие/отзыв, полученные сотрудником лично или по телефону. */
  @Post(':id/consents')
  @RequirePermissions(Permission.CustomersManage)
  @ApiCreatedResponse({ type: CustomerDto })
  consent(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RecordConsentDto): Promise<CustomerDto> {
    return this.recordConsent.execute(actor, id, dto);
  }

  /** Обезличить гостя по его требованию (необратимо). */
  @Post(':id/anonymize')
  @HttpCode(200)
  @RequirePermissions(Permission.CustomersManage)
  @ApiOkResponse({ type: CustomerDto })
  anonymize(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnonymizeCustomerDto): Promise<CustomerDto> {
    return this.anonymizeCustomer.execute(actor, id, { reason: dto.reason });
  }
}
