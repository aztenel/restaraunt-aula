import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { DishOptionView, QuoteQueries } from '../../application/admin.queries';
import { BanquetQueries, RequestDetailView } from '../../application/banquet.queries';
import { SignedLink } from '../../application/document-files';
import { SaveQuoteVersion, SendQuote } from '../../application/quote.actions';
import { QuoteSummaryView, QuoteView, quoteView } from '../../application/views';
import { MenuSearchQueryDto, SaveQuoteDto, toDiscount } from '../dto';
import { DishOptionDto, QuoteDto, QuoteSummaryDto, RequestDetailDto, SignedLinkDto } from '../responses.dto';

/** Конструктор сметы: версии (каждое сохранение — новая версия), PDF, отправка клиенту, поиск блюд меню. */
@ApiTags('admin')
@ApiBearerAuth('staff')
@Controller('admin/banquets')
export class AdminBanquetQuotesController {
  constructor(
    private readonly quotes: QuoteQueries,
    private readonly requests: BanquetQueries,
    private readonly saveQuote: SaveQuoteVersion,
    private readonly sendQuote: SendQuote,
  ) {}

  @Get('requests/:id/quotes')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [QuoteSummaryDto] })
  versions(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<QuoteSummaryView[]> {
    return this.quotes.versions(actor, id);
  }

  /** Сохранить смету — новая версия (прошлые не меняются). */
  @Post('requests/:id/quotes')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiCreatedResponse({ type: QuoteDto })
  async save(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveQuoteDto): Promise<QuoteView> {
    const quote = await this.saveQuote.execute(actor, id, {
      lines: dto.lines.map((l) => ({
        kind: l.kind,
        dishId: l.dishId ?? null,
        title: l.title ?? null,
        unit: l.unit ?? null,
        unitPrice: l.unitPrice ? MoneyInputDto.toMoney(l.unitPrice) : null,
        quantity: l.quantity,
        discount: toDiscount(l.discount),
      })),
      discount: toDiscount(dto.discount),
      serviceChargeBp: dto.serviceChargeBp,
      guests: dto.guests ?? null,
      validUntil: dto.validUntil ?? null,
      notes: dto.notes ?? null,
      refreshMenuPrices: dto.refreshMenuPrices ?? false,
    });
    return quoteView(quote, quote.version);
  }

  @Get('quotes/:quoteId')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: QuoteDto })
  get(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<QuoteView> {
    return this.quotes.get(actor, quoteId);
  }

  /** PDF версии сметы под брендом (приватный файл, подписанная ссылка). */
  @Get('quotes/:quoteId/pdf')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: SignedLinkDto })
  pdf(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<SignedLink> {
    return this.quotes.pdfLink(actor, quoteId);
  }

  /** Отправить клиенту (последнюю версию): статус quote_sent, ссылка на страницу сметы. */
  @Post('quotes/:quoteId/send')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: RequestDetailDto })
  async send(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<RequestDetailView> {
    const request = await this.sendQuote.execute(actor, quoteId);
    return this.requests.detail(actor, request.id);
  }

  /** Поиск блюд меню филиала для сметы (цена филиала сейчас; в смету попадает снимок). */
  @Get('menu/dishes')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: [DishOptionDto] })
  dishes(@CurrentActor() actor: Actor, @Query() q: MenuSearchQueryDto): Promise<DishOptionView[]> {
    return this.quotes.searchDishes(actor, q.branchId, q.q, q.limit ?? 20);
  }
}
