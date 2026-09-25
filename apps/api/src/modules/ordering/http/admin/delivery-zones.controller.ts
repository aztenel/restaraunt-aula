import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { DeliveryQueries } from '../../application/delivery.queries';
import { CreateDeliveryZone, DeleteDeliveryZone, UpdateDeliveryZone } from '../../application/delivery-zone.actions';
import { CreateDeliveryZoneDto, DeliveryZoneDto, DeliveryZoneInputDto, ZoneListQueryDto } from '../dto/zones.dto';

/** Зоны доставки филиалов (delivery_zones.manage в филиале). Зоны одного филиала не пересекаются. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@RequirePermissions(Permission.DeliveryZonesManage)
@Controller('admin/delivery-zones')
export class AdminDeliveryZonesController {
  constructor(
    private readonly queries: DeliveryQueries,
    private readonly createZone: CreateDeliveryZone,
    private readonly updateZone: UpdateDeliveryZone,
    private readonly deleteZone: DeleteDeliveryZone,
  ) {}

  @Get()
  @ApiOkResponse({ type: [DeliveryZoneDto] })
  async list(@CurrentActor() actor: Actor, @Query() q: ZoneListQueryDto): Promise<DeliveryZoneDto[]> {
    return (await this.queries.adminZones(actor, q.branchId ?? null)).map(DeliveryZoneDto.from);
  }

  @Get(':id')
  @ApiOkResponse({ type: DeliveryZoneDto })
  async get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<DeliveryZoneDto> {
    return DeliveryZoneDto.from(await this.queries.adminZone(actor, id));
  }

  @Post()
  @ApiCreatedResponse({ type: DeliveryZoneDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateDeliveryZoneDto): Promise<DeliveryZoneDto> {
    return DeliveryZoneDto.from(await this.createZone.execute(actor, dto.branchId, DeliveryZoneInputDto.toDefinition(dto)));
  }

  @Put(':id')
  @ApiOkResponse({ type: DeliveryZoneDto })
  async update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliveryZoneInputDto): Promise<DeliveryZoneDto> {
    return DeliveryZoneDto.from(await this.updateZone.execute(actor, id, DeliveryZoneInputDto.toDefinition(dto)));
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteZone.execute(actor, id);
  }
}
