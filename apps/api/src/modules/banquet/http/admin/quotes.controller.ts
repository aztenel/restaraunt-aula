import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequirePermissions } from '../../../../shared/infrastructure/http/decorators';
import { MoneyInputDto } from '../../../../shared/infrastructure/http/api-types';
import { Actor } from '../../../../shared/kernel/actor';
import { Permission } from '../../../../shared/kernel/permissions';
import { DishOptionView, QuoteQueries } from '../../application/admin.queries';
import { BanquetQueries, RequestDetailView } from '../../application/banquet.queries';
import { SignedLink } from '../../application/document-files';
import { PreviewQuote, SaveQuoteInput, SaveQuoteVersion, SendQuote } from '../../application/quote.actions';
import { QuotePreviewView, quotePreviewView, QuoteSummaryView, QuoteView, quoteView } from '../../application/views';
import { BanquetMenuSearchQueryDto, BanquetSaveQuoteDto, toDiscount } from '../dto';
import {
  BanquetDishOptionDto,
  BanquetQuoteDto,
  BanquetQuotePreviewDto,
  BanquetQuoteSummaryDto,
  BanquetRequestDetailDto,
  BanquetSignedLinkDto,
} from '../responses.dto';

function saveQuoteInput(dto: BanquetSaveQuoteDto): SaveQuoteInput {
  return {
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
  };
}

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
    private readonly previewQuote: PreviewQuote,
  ) {}

  @Get('requests/:id/quotes')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: [BanquetQuoteSummaryDto] })
  versions(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string): Promise<QuoteSummaryView[]> {
    return this.quotes.versions(actor, id);
  }

  /** Сохранить смету — новая версия (прошлые не меняются). */
  @Post('requests/:id/quotes')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiCreatedResponse({ type: BanquetQuoteDto })
  async save(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetSaveQuoteDto): Promise<QuoteView> {
    const quote = await this.saveQuote.execute(actor, id, saveQuoteInput(dto));
    return quoteView(quote, quote.version);
  }

  /** Предпросмотр сметы: итоги по тем же правилам, что и при сохранении, без новой версии. */
  @Post('requests/:id/quotes/preview')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetQuotePreviewDto })
  async preview(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BanquetSaveQuoteDto): Promise<QuotePreviewView> {
    const p = await this.previewQuote.execute(actor, id, saveQuoteInput(dto));
    return quotePreviewView({
      requestId: p.request.id,
      branchId: p.request.branchId,
      guests: p.guests,
      discount: p.discount,
      serviceChargeBp: p.serviceChargeBp,
      seller: p.seller,
      lines: p.calc.lines,
      totals: p.calc.totals,
      validUntil: p.validUntil,
      notes: p.notes,
    });
  }

  @Get('quotes/:quoteId')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetQuoteDto })
  get(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<QuoteView> {
    return this.quotes.get(actor, quoteId);
  }

  /** PDF версии сметы под брендом (приватный файл, подписанная ссылка). */
  @Get('quotes/:quoteId/pdf')
  @RequirePermissions(Permission.BanquetsView)
  @ApiOkResponse({ type: BanquetSignedLinkDto })
  pdf(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<SignedLink> {
    return this.quotes.pdfLink(actor, quoteId);
  }

  /** Отправить клиенту (последнюю версию): статус quote_sent, ссылка на страницу сметы. */
  @Post('quotes/:quoteId/send')
  @HttpCode(200)
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: BanquetRequestDetailDto })
  async send(@CurrentActor() actor: Actor, @Param('quoteId', ParseUUIDPipe) quoteId: string): Promise<RequestDetailView> {
    const request = await this.sendQuote.execute(actor, quoteId);
    return this.requests.detail(actor, request.id);
  }

  /** Поиск блюд меню филиала для сметы (цена филиала сейчас; в смету попадает снимок). */
  @Get('menu/dishes')
  @RequirePermissions(Permission.BanquetsManage)
  @ApiOkResponse({ type: [BanquetDishOptionDto] })
  dishes(@CurrentActor() actor: Actor, @Query() q: BanquetMenuSearchQueryDto): Promise<DishOptionView[]> {
    return this.quotes.searchDishes(actor, q.branchId, q.q, q.limit ?? 20);
  }
}
