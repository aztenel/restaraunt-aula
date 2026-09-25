import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Page, pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { CompanyQueries } from '../../application/admin.queries';
import { CreateClientCompany, DeleteClientCompany, UpdateClientCompany } from '../../application/company.actions';
import { ClientCompanyRecord } from '../../infrastructure/company.repository';
import { BanquetCompaniesQueryDto, BanquetCompanyInputDto } from '../dto';
import { BanquetCompaniesPageDto, BanquetCompanyDto } from '../responses.dto';

/** Реквизиты компаний-заказчиков: хранятся и переиспользуются (договор, счёт, акт, ЭСФ). */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets/companies')
export class AdminBanquetCompaniesController {
  constructor(
    private readonly queries: CompanyQueries,
    private readonly createCompany: CreateClientCompany,
    private readonly updateCompany: UpdateClientCompany,
    private readonly deleteCompany: DeleteClientCompany,
  ) {}

  @Get()
  @RequirePermissions(Permission.BanquetsView, Permission.BanquetsInvoice)
  @ApiOkResponse({ type: BanquetCompaniesPageDto })
  search(@CurrentActor() actor: Actor, @Query() q: BanquetCompaniesQueryDto): Promise<Page<ClientCompanyRecord>> {
    return this.queries.search(actor, q.q, pageRequest(q.page, q.perPage));
  }

  @Get(':id')
  @RequirePermissions(Permission.BanquetsView, Permission.BanquetsInvoice)
  @ApiOkResponse({ type: BanquetCompanyDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ClientCompanyRecord> {
    return this.queries.get(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiCreatedResponse({ type: BanquetCompanyDto })
  create(@CurrentActor() actor: Actor, @Body() dto: BanquetCompanyInputDto): Promise<ClientCompanyRecord> {
    return this.createCompany.execute(actor, dto);
  }

  @Put(':id')
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiOkResponse({ type: BanquetCompanyDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetCompanyInputDto): Promise<ClientCompanyRecord> {
    return this.updateCompany.execute(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.BanquetsManage, Permission.BanquetsInvoice)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteCompany.execute(actor, id);
  }
}
