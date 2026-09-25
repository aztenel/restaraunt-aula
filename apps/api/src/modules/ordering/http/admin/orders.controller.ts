import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { ClientIp, CurrentActor, RequestLocale, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { Actor } from '../../../../shared/kernel/actor';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Permission } from '../../../../shared/kernel/permissions';
import { addDays, DEFAULT_TIMEZONE, startOfLocalDay } from '../../../../shared/kernel/time';
import { Locale } from '../../../../shared/kernel/translatable';
import { CancelCourierDispatch, RetryCourierDispatch } from '../../application/courier-dispatch.actions';
import { OrderLinks } from '../../application/order-links';
import { OrderQueries } from '../../application/order.queries';
import { CancelOrder, RefundOrder, RejectOrder, TransitionOrder } from '../../application/order-staff.actions';
import { PlaceOrder } from '../../application/place-order.action';
import { QuoteOrder } from '../../application/quote-order.action';
import {
  AdminCreateOrderDto,
  AdminOrderDetailsDto,
  AdminOrderListItemDto,
  AdminOrderListQueryDto,
  AdminOrderQueueDto,
  AdminOrdersPageDto,
  AdminQueueQueryDto,
  CancelOrderDto,
  RefundOrderDto,
  TransitionOrderDto,
} from '../dto/admin-orders.dto';
import { checkoutInput, OrderQuoteDto, quoteInput, QuoteOrderDto } from '../dto/public.dto';

/**
 * Заказы в админке: список с фильтрами, очередь оператора (со звуком новых — лента админки), карточка,
 * смена статуса, отказ, отмена, частичный возврат, телефонный заказ, курьер службы доставки.
 * Доступ к филиалу проверяется в действиях (actor.assertCan / scopeBranches).
 */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(
    private readonly queries: OrderQueries,
    private readonly quote: QuoteOrder,
    private readonly placeOrder: PlaceOrder,
    private readonly transitionOrder: TransitionOrder,
    private readonly rejectOrder: RejectOrder,
    private readonly cancelOrder: CancelOrder,
    private readonly refundOrder: RefundOrder,
    private readonly retryCourier: RetryCourierDispatch,
    private readonly cancelCourier: CancelCourierDispatch,
    private readonly links: OrderLinks,
  ) {}

  private async details(actor: Actor, orderId: string): Promise<AdminOrderDetailsDto> {
    const view = await this.queries.details(actor, orderId);
    return AdminOrderDetailsDto.fromView(view, this.links.tracking(view.order.publicToken, view.order.locale));
  }

  @RequirePermissions(Permission.OrdersView)
  @Get()
  @ApiOkResponse({ type: AdminOrdersPageDto })
  async list(@CurrentActor() actor: Actor, @Query() q: AdminOrderListQueryDto): Promise<AdminOrdersPageDto> {
    const page = await this.queries.list(
      actor,
      {
        branchId: q.branchId ?? null,
        statuses: q.status,
        type: q.type,
        from: q.dateFrom ? startOfLocalDay(q.dateFrom, DEFAULT_TIMEZONE) : undefined,
        to: q.dateTo ? startOfLocalDay(addDays(q.dateTo, 1), DEFAULT_TIMEZONE) : undefined,
        q: q.q,
      },
      pageRequest(q.page, q.perPage),
    );
    return { ...page, items: page.items.map(AdminOrderListItemDto.from) };
  }

  /** Очередь оператора: активные заказы по статусам, с позициями и доступными переходами. */
  @RequirePermissions(Permission.OrdersView)
  @Get('queue')
  @ApiOkResponse({ type: AdminOrderQueueDto })
  async queue(@CurrentActor() actor: Actor, @Query() q: AdminQueueQueryDto): Promise<AdminOrderQueueDto> {
    return AdminOrderQueueDto.from(await this.queries.queue(actor, q.branchId ?? null));
  }

  /** Расчёт телефонного заказа (суммы считает сервер). */
  @RequirePermissions(Permission.OrdersManage)
  @Post('quote')
  @HttpCode(200)
  @ApiOkResponse({ type: OrderQuoteDto })
  async quoteOrder(@CurrentActor() actor: Actor, @Body() dto: QuoteOrderDto, @RequestLocale() locale: Locale): Promise<OrderQuoteDto> {
    actor.assertCan(Permission.OrdersManage, dto.branchId);
    return OrderQuoteDto.from(await this.quote.execute(quoteInput(dto)), locale);
  }

  /** Телефонный заказ (канал admin): оплата при получении или онлайн — ссылка уходит гостю уведомлением. */
  @RequirePermissions(Permission.OrdersManage)
  @Post()
  @ApiCreatedResponse({ type: AdminOrderDetailsDto })
  async create(@CurrentActor() actor: Actor, @Body() dto: AdminCreateOrderDto, @ClientIp() ip: string | null): Promise<AdminOrderDetailsDto> {
    const placed = await this.placeOrder.execute(checkoutInput(dto), { channel: 'admin', actor, ip });
    return this.details(actor, placed.order.id);
  }

  @RequirePermissions(Permission.OrdersView)
  @Get(':id')
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDetailsDto> {
    return this.details(actor, id);
  }

  /** Смена статуса: принят, готовится, готов, в пути, выполнен (выполнение отмечает получение оплаты при получении). */
  @RequirePermissions(Permission.OrdersManage)
  @Post(':id/transition')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async transition(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TransitionOrderDto): Promise<AdminOrderDetailsDto> {
    await this.transitionOrder.execute(actor, id, dto.to);
    return this.details(actor, id);
  }

  /** Отказ от оплаченного заказа: paid → accepted → cancelled в одной транзакции и возврат. */
  @RequirePermissions(Permission.OrdersManage)
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async reject(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto): Promise<AdminOrderDetailsDto> {
    await this.rejectOrder.execute(actor, id, {
      reasonCode: dto.reasonCode,
      reason: dto.reason ?? null,
      refundAmount: dto.refundAmount ? MoneyInputDto.toMoney(dto.refundAmount) : null,
    });
    return this.details(actor, id);
  }

  /** Отмена из «ожидает оплаты» или «принят»; частичная сумма возврата — право orders.refund. */
  @RequirePermissions(Permission.OrdersManage)
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto): Promise<AdminOrderDetailsDto> {
    await this.cancelOrder.execute(actor, id, {
      reasonCode: dto.reasonCode,
      reason: dto.reason ?? null,
      refundAmount: dto.refundAmount ? MoneyInputDto.toMoney(dto.refundAmount) : null,
    });
    return this.details(actor, id);
  }

  /** Частичный возврат по принятому…выполненному заказу (недовложение); статус заказа не меняется. */
  @RequirePermissions(Permission.OrdersRefund)
  @Post(':id/refund')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async refund(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundOrderDto): Promise<AdminOrderDetailsDto> {
    await this.refundOrder.execute(actor, id, { amount: MoneyInputDto.toMoney(dto.amount), reason: dto.reason });
    return this.details(actor, id);
  }

  /** Повторно вызвать курьера службы доставки (прошлая заявка не удалась или отменена). */
  @RequirePermissions(Permission.OrdersManage)
  @Post(':id/courier/retry')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async courierRetry(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDetailsDto> {
    await this.retryCourier.execute(actor, id);
    return this.details(actor, id);
  }

  /** Отменить заявку службы доставки (например, везёт свой курьер). */
  @RequirePermissions(Permission.OrdersManage)
  @Post(':id/courier/cancel')
  @HttpCode(200)
  @ApiOkResponse({ type: AdminOrderDetailsDto })
  async courierCancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<AdminOrderDetailsDto> {
    await this.cancelCourier.execute(actor, id);
    return this.details(actor, id);
  }
}
