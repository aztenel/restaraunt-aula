import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ClientIp, CurrentActor, Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { RateLimit } from '../../../../shared/infrastructure/rate-limit/rate-limit.guard';
import { Actor } from '../../../../shared/kernel/actor';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { BanquetSupport } from '../../application/banquet-support';
import { CreateBanquetRequest } from '../../application/create-request.action';
import { RenewInvoicePayment } from '../../application/invoice.actions';
import { EventTypeView, PublicBanquetQueries, PublicInvoiceView, PublicQuoteView } from '../../application/public.queries';
import { AcceptQuote } from '../../application/quote.actions';
import { BanquetAcceptQuoteDto, moneyOrNull, BanquetPublicCreateRequestDto } from '../dto';
import { BanquetEventTypeDto, BanquetPublicAcceptResultDto, BanquetPublicInvoiceDto, BanquetPublicQuoteDto, BanquetPublicRequestCreatedDto } from '../responses.dto';

/**
 * Банкеты на витрине: заявка (форма с согласием на обработку ПД), страница сметы по ссылке
 * с согласованием, страница счёта с онлайн-оплатой.
 */
@ApiTags('public')
@Public()
@Controller('public/banquets')
export class PublicBanquetsController {
  constructor(
    private readonly create: CreateBanquetRequest,
    private readonly accept: AcceptQuote,
    private readonly renewPayment: RenewInvoicePayment,
    private readonly queries: PublicBanquetQueries,
    private readonly support: BanquetSupport,
  ) {}

  @Get('event-types')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: [BanquetEventTypeDto] })
  eventTypes(@RequestLocale() locale: Locale): EventTypeView[] {
    return this.queries.eventTypes(locale);
  }

  /** Заявка на банкет или выездное обслуживание. Назначается менеджеру автоматически. */
  @Post('requests')
  @RateLimit('forms')
  @ApiCreatedResponse({ type: BanquetPublicRequestCreatedDto })
  async request(@CurrentActor() actor: Actor, @Body() dto: BanquetPublicCreateRequestDto, @ClientIp() ip: string | null): Promise<BanquetPublicRequestCreatedDto> {
    const request = await this.create.execute(
      actor,
      {
        eventDate: dto.eventDate,
        eventTime: dto.eventTime ?? null,
        eventType: dto.eventType,
        guests: dto.guests,
        branchId: dto.branchId ?? null,
        isOffsite: dto.offsite ?? false,
        offsiteAddress: dto.address ?? null,
        budget: moneyOrNull(dto.budget),
        contact: dto.contact,
        wishes: dto.wishes ?? null,
        locale: dto.locale,
        consent: dto.consent,
      },
      { source: 'web', ip },
    );
    const manager = await this.support.manager(request.managerId);
    return { number: request.number, status: request.status, managerName: manager.name, managerPhone: manager.phone };
  }

  /** Страница сметы: последняя отправленная версия + PDF. */
  @Get('quotes/:token')
  @RateLimit('tracking')
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: BanquetPublicQuoteDto })
  quote(@Param('token') token: string, @RequestLocale() locale: Locale): Promise<PublicQuoteView> {
    return this.queries.quote(token, locale);
  }

  /** Согласовать смету: только последнюю отправленную версию, пока заявка в статусе «смета отправлена». */
  @Post('quotes/:token/accept')
  @HttpCode(200)
  @RateLimit('forms')
  @ApiOkResponse({ type: BanquetPublicAcceptResultDto })
  async acceptQuote(@Param('token') token: string, @Body() dto: BanquetAcceptQuoteDto): Promise<BanquetPublicAcceptResultDto> {
    const { request, quote } = await this.accept.execute(token, { version: dto.version });
    const required = request.requiredPrepayment(quote.totals.total);
    return { status: request.status, version: quote.version, prepayment: required?.toJSON() ?? null };
  }

  /** Страница счёта: сумма, статус, ссылка на оплату (физлицо) или PDF с реквизитами (юрлицо). */
  @Get('invoices/:token')
  @RateLimit('tracking')
  @ApiOkResponse({ type: BanquetPublicInvoiceDto })
  invoice(@Param('token') token: string): Promise<PublicInvoiceView> {
    return this.queries.invoice(token);
  }

  /** Новая ссылка на оплату, если прежняя истекла или платёж не прошёл. */
  @Post('invoices/:token/pay')
  @HttpCode(200)
  @RateLimit('forms')
  @ApiOkResponse({ type: BanquetPublicInvoiceDto })
  async pay(@Param('token') token: string): Promise<PublicInvoiceView> {
    await this.renewPayment.execute(token);
    return this.queries.invoice(token);
  }
}
