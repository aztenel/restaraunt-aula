import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { AggregatorVolumeQueries, DeleteAggregatorVolume, SaveAggregatorVolume } from '../../application/aggregator-volume.actions';
import { AggregatorVolumeRecord } from '../../infrastructure/aggregator-volume.repository';
import { AggregatorVolumeDto, AggregatorVolumeInputDto, AggregatorVolumesQueryDto } from '../dto';

/**
 * Помесячные итоги агрегаторов (ручной ввод) для отчёта «Доля своего канала»:
 * заказы агрегаторов в систему не попадают.
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/reports/aggregator-volumes')
export class AggregatorVolumesController {
  constructor(
    private readonly save: SaveAggregatorVolume,
    private readonly queries: AggregatorVolumeQueries,
    private readonly remove: DeleteAggregatorVolume,
  ) {}

  @RequirePermissions(Permission.ReportsBranch, Permission.ReportsConsolidated)
  @Get()
  @ApiOkResponse({ type: [AggregatorVolumeDto] })
  list(@CurrentActor() actor: Actor, @Query() q: AggregatorVolumesQueryDto): Promise<AggregatorVolumeRecord[]> {
    return this.queries.list(actor, q);
  }

  /** Создать или обновить итог за месяц (филиал × месяц × источник). */
  @RequirePermissions(Permission.ReportsBranch)
  @Put()
  @ApiOkResponse({ type: AggregatorVolumeDto })
  upsert(@CurrentActor() actor: Actor, @Body() dto: AggregatorVolumeInputDto): Promise<AggregatorVolumeRecord> {
    return this.save.execute(actor, {
      branchId: dto.branchId,
      month: dto.month,
      source: dto.source,
      sourceName: dto.sourceName,
      orders: dto.orders,
      revenue: dto.revenue ? MoneyInputDto.toMoney(dto.revenue) : null,
    });
  }

  /** Удалить ошибочно введённый итог (журнал действий). */
  @RequirePermissions(Permission.ReportsBranch)
  @Delete(':id')
  @HttpCode(204)
  @ApiNoContentResponse()
  async delete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.remove.execute(actor, id);
  }
}
