import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { ContentPublicQueries } from '../../application/content-public.queries';
import { PUBLIC_CACHE_CONTROL } from '../dto/common.dto';
import {
  PublicBannerDto,
  PublicBannersQueryDto,
  PublicPageDto,
  PublicPageSummaryDto,
  PublicPromotionDto,
  PublicPromotionsQueryDto,
} from '../dto/public.dto';

/** Контент витрины: баннеры, действующие акции, статические страницы (оферта, политика, доставка...). */
@ApiTags('public')
@Public()
@Controller('public/content')
export class PublicContentController {
  constructor(private readonly content: ContentPublicQueries) {}

  @Get('banners')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiOkResponse({ type: [PublicBannerDto] })
  banners(@Query() query: PublicBannersQueryDto, @RequestLocale() locale: Locale): Promise<PublicBannerDto[]> {
    return this.content.bannerList({ placement: query.placement, branchSlug: query.branch }, locale);
  }

  @Get('promotions')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiOkResponse({ type: [PublicPromotionDto] })
  promotions(@Query() query: PublicPromotionsQueryDto, @RequestLocale() locale: Locale): Promise<PublicPromotionDto[]> {
    return this.content.promotionList(query.branch, locale);
  }

  @Get('promotions/:slug')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicPromotionDto })
  promotion(@Param('slug') slug: string, @RequestLocale() locale: Locale): Promise<PublicPromotionDto> {
    return this.content.promotionBySlug(slug, locale);
  }

  @Get('pages')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: [PublicPageSummaryDto] })
  pages(@RequestLocale() locale: Locale): Promise<PublicPageSummaryDto[]> {
    return this.content.pageList(locale);
  }

  @Get('pages/:slug')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicPageDto })
  page(@Param('slug') slug: string, @RequestLocale() locale: Locale): Promise<PublicPageDto> {
    return this.content.pageBySlug(slug, locale);
  }
}
