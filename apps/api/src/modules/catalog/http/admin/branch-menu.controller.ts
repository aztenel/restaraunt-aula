import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import {
  AddDishToBranchMenu,
  BulkAddDishesToBranchMenu,
  BulkSetBranchPrices,
  CopyBranchMenu,
  RemoveDishFromBranchMenu,
  SetBranchDishPrice,
} from '../../application/branch-menu.actions';
import { CatalogAdminQueries } from '../../application/catalog-admin.queries';
import { SetDishAvailability } from '../../application/stop-list.actions';
import {
  AddMenuItemDto,
  AvailabilityResultDto,
  BranchMenuItemDto,
  BulkAddMenuItemsDto,
  BulkAddMenuItemsResultDto,
  BranchMenuPageDto,
  BranchMenuQueryDto,
  BulkPricesDto,
  BulkPricesResultDto,
  CopyMenuDto,
  CopyMenuResultDto,
  SetAvailabilityDto,
  SetPriceDto,
  SetSkuDto,
} from '../dto/menu-admin.dto';

/**
 * Меню филиала: цены и стоп-лист всегда в разрезе филиала. Проверка филиала — в действиях
 * (управляющий — только свой филиал, контент-менеджер и собственник — все).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/catalog/branches/:branchId')
export class AdminBranchMenuController {
  constructor(
    private readonly queries: CatalogAdminQueries,
    private readonly addDish: AddDishToBranchMenu,
    private readonly removeDish: RemoveDishFromBranchMenu,
    private readonly setPrice: SetBranchDishPrice,
    private readonly bulkSetPrices: BulkSetBranchPrices,
    private readonly copyMenu: CopyBranchMenu,
    private readonly setAvailability: SetDishAvailability,
    private readonly bulkAdd: BulkAddDishesToBranchMenu,
  ) {}

  @RequirePermissions(Permission.MenuPrices, Permission.MenuStopList, Permission.MenuContent)
  @Get('menu')
  @ApiOkResponse({ type: BranchMenuPageDto })
  list(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: BranchMenuQueryDto,
  ): Promise<BranchMenuPageDto> {
    return this.queries.branchMenuPage(
      actor,
      branchId,
      { q: query.q, categoryId: query.categoryId, availability: query.availability },
      pageRequest(query.page, query.perPage ?? 200),
    );
  }

  @RequirePermissions(Permission.MenuPrices)
  @Post('menu')
  @ApiCreatedResponse({ type: BranchMenuItemDto })
  async add(@CurrentActor() actor: Actor, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: AddMenuItemDto): Promise<BranchMenuItemDto> {
    await this.addDish.execute(actor, branchId, { dishId: dto.dishId, price: MoneyInputDto.toMoney(dto.price), sku: dto.sku });
    return this.queries.branchMenuItem(actor, branchId, dto.dishId);
  }

  /** Добавить несколько блюд в меню филиала (всё или ничего). */
  @RequirePermissions(Permission.MenuPrices)
  @Post('menu/bulk-add')
  @HttpCode(200)
  @ApiOkResponse({ type: BulkAddMenuItemsResultDto })
  bulkAddItems(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: BulkAddMenuItemsDto,
  ): Promise<BulkAddMenuItemsResultDto> {
    return this.bulkAdd.execute(
      actor,
      branchId,
      dto.items.map((i) => ({ dishId: i.dishId, price: MoneyInputDto.toMoney(i.price), sku: i.sku })),
    );
  }

  /** Массовое изменение цен (всё или ничего). */
  @RequirePermissions(Permission.MenuPrices)
  @Post('menu/bulk-prices')
  @HttpCode(200)
  @ApiOkResponse({ type: BulkPricesResultDto })
  bulk(@CurrentActor() actor: Actor, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: BulkPricesDto): Promise<BulkPricesResultDto> {
    return this.bulkSetPrices.execute(
      actor,
      branchId,
      dto.items.map((i) => ({ dishId: i.dishId, price: MoneyInputDto.toMoney(i.price) })),
    );
  }

  /** Скопировать меню другого филиала в этот (недостающие блюда + опционально цены). */
  @RequirePermissions(Permission.MenuPrices)
  @Post('menu/copy')
  @HttpCode(200)
  @ApiOkResponse({ type: CopyMenuResultDto })
  copy(@CurrentActor() actor: Actor, @Param('branchId', ParseUUIDPipe) branchId: string, @Body() dto: CopyMenuDto): Promise<CopyMenuResultDto> {
    return this.copyMenu.execute(actor, { fromBranchId: dto.fromBranchId, toBranchId: branchId, overwritePrices: dto.overwritePrices ?? false });
  }

  @RequirePermissions(Permission.MenuPrices, Permission.MenuStopList, Permission.MenuContent)
  @Get('menu/:dishId')
  @ApiOkResponse({ type: BranchMenuItemDto })
  get(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
  ): Promise<BranchMenuItemDto> {
    return this.queries.branchMenuItem(actor, branchId, dishId);
  }

  @RequirePermissions(Permission.MenuPrices)
  @Put('menu/:dishId/price')
  @ApiOkResponse({ type: BranchMenuItemDto })
  async price(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
    @Body() dto: SetPriceDto,
  ): Promise<BranchMenuItemDto> {
    await this.setPrice.execute(actor, branchId, dishId, { price: MoneyInputDto.toMoney(dto.price), sku: dto.sku });
    return this.queries.branchMenuItem(actor, branchId, dishId);
  }

  /** Только код POS филиала (цена не меняется); null — сбросить к общему коду блюда. */
  @RequirePermissions(Permission.MenuPrices)
  @Put('menu/:dishId/sku')
  @ApiOkResponse({ type: BranchMenuItemDto })
  async sku(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
    @Body() dto: SetSkuDto,
  ): Promise<BranchMenuItemDto> {
    await this.setPrice.execute(actor, branchId, dishId, { sku: dto.sku ?? null });
    return this.queries.branchMenuItem(actor, branchId, dishId);
  }

  @RequirePermissions(Permission.MenuPrices)
  @Delete('menu/:dishId')
  @HttpCode(204)
  @ApiNoContentResponse()
  async remove(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
  ): Promise<void> {
    await this.removeDish.execute(actor, branchId, dishId);
  }

  /** Стоп-лист: поставить в стоп (опционально «до» времени) или вернуть в продажу. */
  @RequirePermissions(Permission.MenuStopList)
  @Put('menu/:dishId/availability')
  @ApiOkResponse({ type: AvailabilityResultDto })
  async availability(
    @CurrentActor() actor: Actor,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('dishId', ParseUUIDPipe) dishId: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<AvailabilityResultDto> {
    const { changed } = await this.setAvailability.execute(actor, {
      branchId,
      dishId,
      available: dto.available,
      until: dto.until ? new Date(dto.until) : null,
      untilEndOfDay: dto.untilEndOfDay ?? false,
      reason: dto.reason,
      source: 'manual',
    });
    return { changed, item: await this.queries.branchMenuItem(actor, branchId, dishId) };
  }

  /** Текущий стоп-лист филиала. */
  @RequirePermissions(Permission.MenuPrices, Permission.MenuStopList, Permission.MenuContent)
  @Get('stop-list')
  @ApiOkResponse({ type: [BranchMenuItemDto] })
  stopList(@CurrentActor() actor: Actor, @Param('branchId', ParseUUIDPipe) branchId: string): Promise<BranchMenuItemDto[]> {
    return this.queries.stopList(actor, branchId);
  }
}
