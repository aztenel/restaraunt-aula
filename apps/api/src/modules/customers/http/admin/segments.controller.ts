import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { SegmentQueries } from '../../application/customers.queries';
import { CreateCustomerSegment, DeleteCustomerSegment, UpdateCustomerSegment } from '../../application/segment.actions';
import { SaveSegmentDto, SegmentDetailDto, SegmentDto } from '../dto';

/** Сегменты гостей — сохранённые фильтры для выгрузок. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/customer-segments')
export class AdminCustomerSegmentsController {
  constructor(
    private readonly queries: SegmentQueries,
    private readonly createSegment: CreateCustomerSegment,
    private readonly updateSegment: UpdateCustomerSegment,
    private readonly deleteSegment: DeleteCustomerSegment,
  ) {}

  @Get()
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: [SegmentDto] })
  list(@CurrentActor() actor: Actor): Promise<SegmentDto[]> {
    return this.queries.list(actor);
  }

  @Get(':id')
  @RequirePermissions(Permission.CustomersView)
  @ApiOkResponse({ type: SegmentDetailDto })
  async get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<SegmentDetailDto> {
    const segment = await this.queries.get(actor, id);
    return { ...segment, customersCount: segment.customersCount ?? 0 };
  }

  @Post()
  @RequirePermissions(Permission.CustomersManage)
  @ApiCreatedResponse({ type: SegmentDto })
  create(@CurrentActor() actor: Actor, @Body() dto: SaveSegmentDto): Promise<SegmentDto> {
    return this.createSegment.execute(actor, { name: dto.name, description: dto.description, filter: { ...dto.filter } });
  }

  @Patch(':id')
  @RequirePermissions(Permission.CustomersManage)
  @ApiOkResponse({ type: SegmentDto })
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveSegmentDto): Promise<SegmentDto> {
    return this.updateSegment.execute(actor, id, { name: dto.name, description: dto.description, filter: { ...dto.filter } });
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions(Permission.CustomersManage)
  @ApiNoContentResponse()
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.deleteSegment.execute(actor, id);
  }
}
