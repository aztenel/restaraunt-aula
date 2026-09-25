import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsISO8601, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { Translatable } from '../../../../shared/kernel/translatable';
import { BANNER_PLACEMENTS } from '../../domain/content';
import { ImageDto, MissingTranslationDto } from './common.dto';

// ---------------------------------------------------------------- Баннеры

export class BannerInputDto {
  @ApiProperty({ enum: BANNER_PLACEMENTS }) @IsIn(BANNER_PLACEMENTS) placement: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Филиал; null — для всех филиалов' }) @IsOptional() @IsUUID() branchId?: string | null;

  @ApiProperty({ type: TranslatableDto })
  @ValidateNested()
  @Type(() => TranslatableDto)
  title: TranslatableDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  subtitle?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true, description: 'Текст кнопки' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  ctaLabel?: TranslatableDto | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '/greenline/menu', description: 'Путь на сайте или http(s) URL' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  linkUrl?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Показывать с (ISO 8601)' }) @IsOptional() @IsISO8601({ strict: true }) activeFrom?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Показывать до (ISO 8601, не включая)' }) @IsOptional() @IsISO8601({ strict: true }) activeTo?: string | null;
  @ApiPropertyOptional({ type: Number }) @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
  @ApiPropertyOptional({ type: Boolean, default: true }) @IsOptional() @IsBoolean() isActive?: boolean | null;
}

export class BannerDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: BANNER_PLACEMENTS }) placement: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) branchId: string | null;
  @ApiProperty({ type: TranslatableDto }) title: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) subtitle: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) ctaLabel: TranslatableDto;
  @ApiPropertyOptional({ type: String, nullable: true }) linkUrl: string | null;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) activeFrom: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) activeTo: Date | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [MissingTranslationDto] }) missingTranslations: MissingTranslationDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class BannerListQueryDto {
  @ApiPropertyOptional({ enum: BANNER_PLACEMENTS }) @IsOptional() @IsIn(BANNER_PLACEMENTS) placement?: string;
  @ApiPropertyOptional({ description: 'Баннеры филиала и общие' }) @IsOptional() @IsUUID() branchId?: string;
}

// ---------------------------------------------------------------- Акции

export class PromotionInputDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'kombo-obed', description: 'Не задан — из заголовка' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string | null;

  @ApiProperty({ type: TranslatableDto })
  @ValidateNested()
  @Type(() => TranslatableDto)
  title: TranslatableDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true, description: 'Условия акции' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  terms?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoTitle?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoDescription?: TranslatableDto | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) @IsOptional() @IsISO8601({ strict: true }) validFrom?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) @IsOptional() @IsISO8601({ strict: true }) validTo?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Филиалы акции; пусто — во всех филиалах' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  branchIds?: string[] | null;

  @ApiPropertyOptional({ type: Number }) @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
  @ApiPropertyOptional({ type: Boolean, default: true }) @IsOptional() @IsBoolean() isActive?: boolean | null;
}

export class PromotionDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) title: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) terms: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoTitle: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoDescription: TranslatableDto;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) validFrom: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) validTo: Date | null;
  @ApiProperty({ type: [String] }) branchIds: string[];
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [MissingTranslationDto] }) missingTranslations: MissingTranslationDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

// ---------------------------------------------------------------- Страницы

/** HTML страницы по языкам (санитизируется при сохранении). */
export class PageBodyDto implements Translatable {
  @ApiPropertyOptional({ description: 'Қазақша (HTML)' }) @IsOptional() @IsString() @MaxLength(200_000) kk?: string;
  @ApiPropertyOptional({ description: 'Русский (HTML)' }) @IsOptional() @IsString() @MaxLength(200_000) ru?: string;
  @ApiPropertyOptional({ description: 'English (HTML)' }) @IsOptional() @IsString() @MaxLength(200_000) en?: string;
}

export class PagePreviewInputDto {
  @ApiProperty({ type: PageBodyDto, description: 'HTML по языкам — как в теле страницы' })
  @IsObject()
  @ValidateNested()
  @Type(() => PageBodyDto)
  body: PageBodyDto;
}

export class PagePreviewDto {
  @ApiProperty({ type: PageBodyDto, description: 'HTML после санитизации (так он будет сохранён); пустые языки убраны' }) body: PageBodyDto;
  @ApiProperty({ description: 'Санитайзер что-то убрал или изменил' }) changed: boolean;
}

export class PageInputDto {
  @ApiPropertyOptional({ type: String, nullable: true, example: 'delivery', description: 'Не задан — из заголовка' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string | null;

  @ApiProperty({ type: TranslatableDto })
  @ValidateNested()
  @Type(() => TranslatableDto)
  title: TranslatableDto;

  @ApiProperty({ type: PageBodyDto })
  @ValidateNested()
  @Type(() => PageBodyDto)
  body: PageBodyDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoTitle?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoDescription?: TranslatableDto | null;

  @ApiPropertyOptional({ type: Boolean, default: true }) @IsOptional() @IsBoolean() isPublished?: boolean | null;
  @ApiPropertyOptional({ type: Number }) @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
}

export class PageDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) title: TranslatableDto;
  @ApiProperty({ type: PageBodyDto }) body: PageBodyDto;
  @ApiProperty({ type: TranslatableDto }) seoTitle: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoDescription: TranslatableDto;
  @ApiProperty() isPublished: boolean;
  @ApiProperty({ description: 'Юридическая страница (оферта, политика): нельзя удалить или снять с публикации' }) isProtected: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty({ type: [MissingTranslationDto] }) missingTranslations: MissingTranslationDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
