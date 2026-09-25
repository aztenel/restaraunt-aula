import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentActor, Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Actor } from '../../../../shared/kernel/actor';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { OrderQueries } from '../../application/order.queries';
import { PlaceOrder } from '../../application/place-order.action';
import { QuoteOrder } from '../../application/quote-order.action';
import { RetryOrderPayment } from '../../application/retry-order-payment.action';
import {
  checkoutInput,
  OrderCheckoutDto,
  OrderCheckoutResultDto,
  OrderPaymentStateDto,
  OrderTrackingDto,
  OrderQuoteDto,
  quoteInput,
  QuoteOrderDto,
} from '../dto/public.dto';

/**
 * Заказ на витрине: расчёт корзины (суммы считает только сервер), оформление, страница статуса
 * по публичному токену, повтор онлайн-оплаты. Формы ограничены по частоте.
 */
@ApiTags('public')
@Public()
@Controller('public/orders')
export class PublicOrdersController {
  constructor(
    private readonly quote: QuoteOrder,
    private readonly placeOrder: PlaceOrder,
    private readonly queries: OrderQueries,
    private readonly retryPayment: RetryOrderPayment,
  ) {}

  /** Расчёт корзины: позиции по меню филиала, скидка, доставка, минимальная сумма, сертификат, итог. */
  @Post('quote')
  @HttpCode(200)
  @RateLimit('pricing')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: OrderQuoteDto })
  async quoteOrder(@Body() dto: QuoteOrderDto, @RequestLocale() locale: Locale): Promise<OrderQuoteDto> {
    return OrderQuoteDto.from(await this.quote.execute(quoteInput(dto)), locale);
  }

  /** Оформление. Идемпотентно по idempotencyKey: повтор возвращает тот же заказ. */
  @Post()
  @RateLimit('forms')
  @ApiCreatedResponse({ type: OrderCheckoutResultDto })
  async checkout(@Body() dto: OrderCheckoutDto, @CurrentActor() actor: Actor, @ClientIp() ip: string | null): Promise<OrderCheckoutResultDto> {
    return OrderCheckoutResultDto.from(await this.placeOrder.execute(checkoutInput(dto), { channel: 'web', actor, ip }));
  }

  /** Статус заказа для гостя: витрина опрашивает его, пока не появится ссылка на оплату. */
  @Get(':publicToken')
  @RateLimit('tracking')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: OrderTrackingDto })
  async track(@Param('publicToken') publicToken: string, @RequestLocale() locale: Locale): Promise<OrderTrackingDto> {
    return OrderTrackingDto.from(await this.queries.tracking(publicToken), locale);
  }

  /** Повторить онлайн-оплату (прошлая попытка отклонена или отменена, заказ ещё ждёт оплаты). */
  @Post(':publicToken/pay')
  @HttpCode(200)
  @RateLimit('forms')
  @ApiOkResponse({ type: OrderPaymentStateDto })
  async pay(@Param('publicToken') publicToken: string): Promise<OrderPaymentStateDto> {
    return OrderPaymentStateDto.from((await this.retryPayment.execute(publicToken)).payment);
  }
}
