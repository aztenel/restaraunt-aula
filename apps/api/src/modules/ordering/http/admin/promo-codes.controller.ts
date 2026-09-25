import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { CreatePromoCode, DeletePromoCode, UpdatePromoCode } from '../../application/promo-code.actions';
import { PromoCodeQueries } from '../../application/promo-code.queries';
import { PromoCodeDto, PromoCodeInputDto, PromoCodesPageDto, PromoListQueryDto } from '../dto/promo-codes.dto';

/**
 * Промокоды (promocodes.manage): промокод филиала — управляющий этого филиала, на всю сеть — только
 * глобальная роль. Использования видны в списке.
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@RequirePermissions(Permission.PromoCodesManage)
@Controller('admin/promo-codes')
export class AdminPromoCodesController {
  constructor(
    private readonly queries: PromoCodeQueries,
    private readonly createPromo: CreatePromoCode,
    private readonly updatePromo: UpdatePromoCode,
    private readonly deletePromo: DeletePromoCode,
  ) {}

  @Get()
  @ApiOkResponse({ type: PromoCodesPageDto })
  async list(@CurrentActor() actor: Actor, @Query() q: PromoListQueryDto): Promise<PromoCodesPageDto> {
    const page = await this.queries.list(actor, { branchId: q.branchId ?? null, scope: q.scope, q: q.q, active: q.active }, pageRequest(q.page, q.perPage));
    return { ...page, items: page.items.map(PromoCodeDto.from) };
  }

  @Get(':id')
  @ApiOkResponse({ type: PromoCodeDto })
  async get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<PromoCodeDto> {
    return PromoCodeDto.from(await this.queries.get(actor, id));
  }

  @Post()
  @ApiCreatedResponse({ type: PromoCodeDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: PromoCodeInputDto): Promise<PromoCodeDto> {
    const promo = await this.createPromo.execute(actor, PromoCodeInputDto.toDefinition(dto));
    return PromoCodeDto.from(await this.queries.get(actor, promo.id));
  }

  @Put(':id')
  @ApiOkResponse({ type: PromoCodeDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PromoCodeInputDto): Promise<PromoCodeDto> {
    await this.updatePromo.execute(actor, id, PromoCodeInputDto.toDefinition(dto));
    return PromoCodeDto.from(await this.queries.get(actor, id));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deletePromo.execute(actor, id);
  }
}
