import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { PublishConsentText } from '../../application/consent.actions';
import { ConsentTextQueries } from '../../application/customers.queries';
import { ConsentTextDto, ConsentTextsQueryDto, PublishConsentTextDto } from '../dto';

/** Версии текстов согласий (ПД и маркетинг). Опубликованная версия не меняется. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/consent-texts')
export class AdminConsentTextsController {
  constructor(
    private readonly queries: ConsentTextQueries,
    private readonly publish: PublishConsentText,
  ) {}

  @Get()
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: [ConsentTextDto] })
  list(@CurrentActor() actor: Actor, @Query() query: ConsentTextsQueryDto): Promise<ConsentTextDto[]> {
    return this.queries.list(actor, query.kind);
  }

  /** Опубликовать новую версию — она сразу становится действующей. */
  @Post()
  @RequirePermissions(Permission.CustomersManage)
  @ApiCreatedResponse({ type: ConsentTextDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: PublishConsentTextDto): Promise<ConsentTextDto> {
    const record = await this.publish.execute(actor, { kind: dto.kind, version: dto.version, text: { ...dto.text } });
    return this.queries.view(record, true);
  }
}
