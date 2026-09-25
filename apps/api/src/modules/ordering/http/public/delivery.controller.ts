import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { DeliveryQueries } from '../../application/delivery.queries';
import { OrderingLocaleQueryDto } from '../dto/common.dto';
import { DeliveryResolutionDto, OrderSlotsDto, OrderSlotsQueryDto, PublicDeliveryZoneDto, ResolveDeliveryDto } from '../dto/public.dto';

/**
 * Доставка на витрине: выбор филиала по точке на карте, зоны филиала для карты, время заказа.
 * Сервер не геокодирует адрес (внешние вызовы — только асинхронно): точку присылает витрина.
 */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicDeliveryController {
  constructor(private readonly delivery: DeliveryQueries) {}

  /** Филиал и зона для точки: меньшая стоимость доставки, при равенстве — ближайший филиал. */
  @Post('delivery/resolve')
  @HttpCode(200)
  @RateLimit('pricing')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: DeliveryResolutionDto })
  async resolve(@Body() dto: ResolveDeliveryDto, @RequestLocale() locale: Locale): Promise<DeliveryResolutionDto> {
    return DeliveryResolutionDto.from(await this.delivery.resolve(dto.point), dto.address?.trim() || null, locale);
  }

  @Get('branches/:branchId/delivery-zones')
  @ApiOkResponse({ type: [PublicDeliveryZoneDto] })
  async zones(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() _query: OrderingLocaleQueryDto,
    @RequestLocale() locale: Locale,
  ): Promise<PublicDeliveryZoneDto[]> {
    const { zones } = await this.delivery.publicZones(branchId);
    return zones.map((z) => PublicDeliveryZoneDto.from(z, locale));
  }

  /** «Как можно скорее» и слоты по 15 минут в часы работы (с учётом времени приготовления). */
  @Get('branches/:branchId/order-slots')
  @ApiOkResponse({ type: OrderSlotsDto })
  async slots(@Param('branchId', ParseUUIDPipe) branchId: string, @Query() query: OrderSlotsQueryDto): Promise<OrderSlotsDto> {
    return OrderSlotsDto.from(await this.delivery.orderSlots(branchId, query.type, query.date ?? null));
  }
}
