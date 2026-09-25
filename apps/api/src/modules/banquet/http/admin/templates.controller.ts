import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { TemplateQueries } from '../../application/admin.queries';
import { DeleteContractTemplate, SaveContractTemplate } from '../../application/template.actions';
import { ContractTemplateRecord } from '../../infrastructure/template.repository';
import { BanquetTemplateInputDto } from '../dto';
import { BanquetContractTemplateDto, BanquetPlaceholderDto } from '../responses.dto';

/** Шаблоны договоров (общие для сети): правят собственник и банкетные менеджеры. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets/contract-templates')
export class AdminBanquetTemplatesController {
  constructor(
    private readonly queries: TemplateQueries,
    private readonly saveTemplate: SaveContractTemplate,
    private readonly deleteTemplate: DeleteContractTemplate,
  ) {}

  @Get()
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetContractTemplateDto] })
  list(@CurrentActor() actor: Actor): Promise<ContractTemplateRecord[]> {
    return this.queries.list(actor);
  }

  /** Допустимые подстановки для редактора шаблона. */
  @Get('placeholders')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetPlaceholderDto] })
  placeholders(): BanquetPlaceholderDto[] {
    return this.queries.placeholders();
  }

  @Get(':id')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetContractTemplateDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<ContractTemplateRecord> {
    return this.queries.get(actor, id);
  }

  @Post()
  @RequirePermissions(Permission.BanquetsManage)
  @ApiCreatedResponse({ type: BanquetContractTemplateDto })
  create(@CurrentActor() actor: Actor, @Body() dto: BanquetTemplateInputDto): Promise<ContractTemplateRecord> {
    return this.saveTemplate.execute(actor, null, dto);
  }

  @Put(':id')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetContractTemplateDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetTemplateInputDto): Promise<ContractTemplateRecord> {
    return this.saveTemplate.execute(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteTemplate.execute(actor, id);
  }
}
