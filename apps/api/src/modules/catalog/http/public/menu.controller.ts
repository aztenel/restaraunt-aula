import { Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Public, RequestLocale } from '../../../../shared/infrastructure/http/decorators';
import { pageRequest } from '../../../../shared/kernel/pagination';
import { Locale, LOCALES } from '../../../../shared/kernel/translatable';
import { StorefrontQueries } from '../../application/storefront.queries';
import { PUBLIC_CACHE_CONTROL } from '../dto/common.dto';
import {
  MenuSearchQueryDto,
  PublicCategoryPageDto,
  PublicDishDetailDto,
  PublicDishPageDto,
  PublicMenuDto,
  SitemapDto,
} from '../dto/public.dto';

/**
 * Витрина: меню филиала (SSR/SEO). Цены и доступность — филиала; стоп-лист отображается
 * по настройке филиала (скрыть / пометить недоступным). Ответы кэшируются CDN (s-maxage=60).
 */
@ApiTags('public')
@Public()
@Controller('public/catalog')
export class PublicMenuController {
  constructor(private readonly storefront: StorefrontQueries) {}

  @Get('branches/:branchSlug/menu')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicMenuDto, description: 'Категории -> блюда с ценами филиала, доступностью, фото, признаками' })
  menu(@Param('branchSlug') branchSlug: string, @RequestLocale() locale: Locale): Promise<PublicMenuDto> {
    return this.storefront.menuOf(branchSlug, locale);
  }

  @Get('branches/:branchSlug/categories/:categorySlug')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicCategoryPageDto })
  category(
    @Param('branchSlug') branchSlug: string,
    @Param('categorySlug') categorySlug: string,
    @RequestLocale() locale: Locale,
  ): Promise<PublicCategoryPageDto> {
    return this.storefront.categoryPage(branchSlug, categorySlug, locale);
  }

  @Get('branches/:branchSlug/dishes/:dishSlug')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiQuery({ name: 'locale', required: false, enum: LOCALES })
  @ApiOkResponse({ type: PublicDishDetailDto, description: 'Карточка блюда: фото, состав, вес, цена филиала, модификаторы' })
  dish(@Param('branchSlug') branchSlug: string, @Param('dishSlug') dishSlug: string, @RequestLocale() locale: Locale): Promise<PublicDishDetailDto> {
    return this.storefront.dish(branchSlug, dishSlug, locale);
  }

  /** Поиск и фильтры: вегетарианское, острое, халал, до N тенге, категория. */
  @Get('branches/:branchSlug/search')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiOkResponse({ type: PublicDishPageDto })
  search(@Param('branchSlug') branchSlug: string, @Query() query: MenuSearchQueryDto, @RequestLocale() locale: Locale): Promise<PublicDishPageDto> {
    return this.storefront.search(
      branchSlug,
      {
        q: query.q,
        vegetarian: query.vegetarian,
        spicy: query.spicy,
        maxSpicyLevel: query.maxSpicyLevel,
        halal: query.halal,
        maxPriceAmount: query.maxPrice,
        categorySlug: query.category,
      },
      pageRequest(query.page ?? 1, Math.min(query.perPage ?? 24, 100)),
      locale,
    );
  }

  /** Данные для sitemap.xml: slug филиалов, категорий, блюд, страниц и акций с датой изменения. */
  @Get('sitemap')
  @Header('Cache-Control', PUBLIC_CACHE_CONTROL)
  @ApiOkResponse({ type: SitemapDto })
  sitemap(): Promise<SitemapDto> {
    return this.storefront.sitemap();
  }
}
