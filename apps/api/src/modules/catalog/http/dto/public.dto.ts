import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MoneyDto, PageDtoOf } from '../../../../shared/infrastructure/http/api-types';
import { LOCALES } from '../../../../shared/kernel/translatable';
import { ALLERGEN_CODES } from '../../domain/allergens';
import { BANNER_PLACEMENTS } from '../../domain/content';
import { DishAvailability } from '../../public';
import { ImageDto, queryBoolean, queryInt, SeoDto } from './common.dto';

/** Публичные DTO витрины: тексты уже переведены на язык запроса (?locale=kk|ru|en). */
const AVAILABILITIES = Object.values(DishAvailability);

export class PublicBranchRefDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
}

export class AllergenDto {
  @ApiProperty({ enum: ALLERGEN_CODES }) code: string;
  @ApiProperty() name: string;
}

export class PublicDishCardDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() categoryId: string;
  @ApiProperty() categorySlug: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ type: MoneyDto, description: 'Цена в этом филиале (без модификаторов)' }) price: MoneyDto;
  @ApiProperty({ description: 'Можно заказать сейчас' }) available: boolean;
  @ApiProperty({ enum: AVAILABILITIES }) availability: string;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Вес порции, г' }) weightGrams: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'ккал на порцию' }) calories: number | null;
  @ApiProperty() isVegetarian: boolean;
  @ApiProperty({ minimum: 0, maximum: 3 }) spicyLevel: number;
  @ApiProperty() isHalal: boolean;
  @ApiProperty({ type: [AllergenDto] }) allergens: AllergenDto[];
  @ApiPropertyOptional({ type: ImageDto, nullable: true, description: 'Обложка (первое фото)' }) photo: ImageDto | null;
  @ApiProperty({ description: 'Есть модификаторы — открыть карточку перед добавлением в корзину' }) hasModifiers: boolean;
  @ApiProperty() hasRequiredModifiers: boolean;
  @ApiProperty() updatedAt: Date;
}

export class PublicModifierOptionDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: MoneyDto, description: 'Доплата' }) price: MoneyDto;
  @ApiProperty() isDefault: boolean;
}

export class PublicModifierGroupDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() minSelect: number;
  @ApiProperty() maxSelect: number;
  @ApiProperty() isRequired: boolean;
  @ApiProperty({ type: [PublicModifierOptionDto] }) options: PublicModifierOptionDto[];
}

export class PublicCategoryRefDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
}

export class PublicCategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
  @ApiProperty({ type: SeoDto }) seo: SeoDto;
  @ApiProperty({ description: 'Число блюд категории в меню филиала' }) dishCount: number;
  @ApiProperty() updatedAt: Date;
}

export class PublicMenuCategoryDto extends PublicCategoryDto {
  @ApiProperty({ type: [PublicDishCardDto] }) dishes: PublicDishCardDto[];
}

export class PublicMenuDto {
  @ApiProperty({ type: PublicBranchRefDto }) branch: PublicBranchRefDto;
  @ApiProperty({ enum: LOCALES }) locale: string;
  @ApiProperty({ type: SeoDto }) seo: SeoDto;
  @ApiProperty({ type: [PublicMenuCategoryDto] }) categories: PublicMenuCategoryDto[];
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'JSON-LD schema.org Menu' }) structuredData: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'JSON-LD schema.org Restaurant (адрес, часы, кухня, hasMenu)' })
  restaurantStructuredData: Record<string, unknown>;
}

export class PublicCategoryPageDto {
  @ApiProperty({ type: PublicBranchRefDto }) branch: PublicBranchRefDto;
  @ApiProperty({ enum: LOCALES }) locale: string;
  @ApiProperty({ type: PublicCategoryDto }) category: PublicCategoryDto;
  @ApiProperty({ type: [PublicCategoryDto], description: 'Навигация по категориям меню филиала' }) categories: PublicCategoryDto[];
  @ApiProperty({ type: [PublicDishCardDto] }) dishes: PublicDishCardDto[];
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'JSON-LD schema.org Menu (раздел)' }) structuredData: Record<string, unknown>;
}

export class PublicDishDetailDto extends PublicDishCardDto {
  @ApiProperty({ description: 'Состав' }) composition: string;
  @ApiProperty({ type: [ImageDto] }) photos: ImageDto[];
  @ApiProperty({ type: [PublicModifierGroupDto] }) modifierGroups: PublicModifierGroupDto[];
  @ApiProperty({ type: PublicCategoryRefDto }) category: PublicCategoryRefDto;
  @ApiProperty({ type: PublicBranchRefDto }) branch: PublicBranchRefDto;
  @ApiProperty({ type: SeoDto }) seo: SeoDto;
  @ApiProperty({ type: 'object', additionalProperties: true, description: 'JSON-LD schema.org MenuItem' }) structuredData: Record<string, unknown>;
}

export class PublicDishPageDto extends PageDtoOf(PublicDishCardDto) {}

export class MenuSearchQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по названию, составу, описанию (ru/kk/en), частичные совпадения' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() vegetarian?: boolean;
  @ApiPropertyOptional({ description: 'true — только острые, false — только неострые' }) @IsOptional() @Transform(queryBoolean) @IsBoolean() spicy?: boolean;
  @ApiPropertyOptional({ minimum: 0, maximum: 3 }) @IsOptional() @Transform(queryInt) @IsInt() @Min(0) @Max(3) maxSpicyLevel?: number;
  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() halal?: boolean;

  @ApiPropertyOptional({ description: 'Цена в филиале не выше, тиыны («до N тенге» = N × 100)', example: 300000 })
  @IsOptional()
  @Transform(queryInt)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'slug категории' }) @IsOptional() @IsString() @MaxLength(80) category?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 24, minimum: 1, maximum: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) perPage?: number;

  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: string;
}

// ---------------------------------------------------------------- Контент

export class PublicBannersQueryDto {
  @ApiPropertyOptional({ enum: BANNER_PLACEMENTS }) @IsOptional() @IsIn(BANNER_PLACEMENTS) placement?: string;
  @ApiPropertyOptional({ description: 'slug филиала: общие баннеры + баннеры филиала' }) @IsOptional() @IsString() @MaxLength(80) branch?: string;
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: string;
}

export class PublicPromotionsQueryDto {
  @ApiPropertyOptional({ description: 'slug филиала: акции сети + акции филиала' }) @IsOptional() @IsString() @MaxLength(80) branch?: string;
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: string;
}

export class PublicBannerDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: BANNER_PLACEMENTS }) placement: string;
  @ApiProperty() title: string;
  @ApiProperty() subtitle: string;
  @ApiProperty() ctaLabel: string;
  @ApiPropertyOptional({ type: String, nullable: true }) linkUrl: string | null;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
}

export class PublicPromotionDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiProperty({ description: 'Условия акции' }) terms: string;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) validFrom: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) validTo: Date | null;
  @ApiProperty({ type: [String], description: 'Филиалы акции; пусто — все филиалы' }) branchIds: string[];
  @ApiProperty({ type: SeoDto }) seo: SeoDto;
  @ApiProperty() updatedAt: Date;
}

export class PublicPageSummaryDto {
  @ApiProperty() slug: string;
  @ApiProperty() title: string;
  @ApiProperty() updatedAt: Date;
}

export class PublicPageDto extends PublicPageSummaryDto {
  @ApiProperty({ description: 'Санитизированный HTML' }) bodyHtml: string;
  @ApiProperty({ type: SeoDto }) seo: SeoDto;
}

// ---------------------------------------------------------------- Sitemap

export class SitemapBranchDto {
  @ApiProperty() slug: string;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
}

export class SitemapCategoryDto {
  @ApiProperty() branchSlug: string;
  @ApiProperty() slug: string;
  @ApiProperty() updatedAt: Date;
}

export class SitemapDishDto {
  @ApiProperty() branchSlug: string;
  @ApiProperty() categorySlug: string;
  @ApiProperty() slug: string;
  @ApiProperty() updatedAt: Date;
}

export class SitemapEntryDto {
  @ApiProperty() slug: string;
  @ApiProperty() updatedAt: Date;
}

export class SitemapDto {
  @ApiProperty({ type: [SitemapBranchDto] }) branches: SitemapBranchDto[];
  @ApiProperty({ type: [SitemapCategoryDto] }) categories: SitemapCategoryDto[];
  @ApiProperty({ type: [SitemapDishDto] }) dishes: SitemapDishDto[];
  @ApiProperty({ type: [SitemapEntryDto] }) pages: SitemapEntryDto[];
  @ApiProperty({ type: [SitemapEntryDto] }) promotions: SitemapEntryDto[];
}
