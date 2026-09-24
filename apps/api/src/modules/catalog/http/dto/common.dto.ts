import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { LOCALES, Locale } from '../../../../shared/kernel/translatable';

/** Кэш публичных ответов витрины (SSR/CDN): 60 с свежие, до 5 мин отдаются с фоновым обновлением. */
export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';

/** Булево значение из строки запроса (?vegetarian=true). */
export function queryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

/** Целое из строки запроса. */
export function queryInt({ value }: { value: unknown }): unknown {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return value;
}

export class ImageVariantDto {
  @ApiProperty({ example: 600 }) width: number;
  @ApiProperty({ example: 400 }) height: number;
  @ApiProperty({ example: 'https://cdn.aula.kz/public/catalog/dishes/…-600.webp' }) url: string;
}

/** Изображение: url варианта по умолчанию и все варианты (для srcset). Формат — webp. */
export class ImageDto {
  @ApiProperty() id: string;
  @ApiProperty() url: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty({ type: [ImageVariantDto] }) variants: ImageVariantDto[];
}

export class PhotoDto extends ImageDto {
  @ApiProperty() sortOrder: number;
}

export class SeoDto {
  @ApiProperty({ description: 'title страницы (уникальный)' }) title: string;
  @ApiProperty({ description: 'meta description' }) description: string;
}

export class MissingTranslationDto {
  @ApiProperty({ example: 'description' }) field: string;
  @ApiProperty({ type: [String], enum: LOCALES, example: ['kk'] }) missing: Locale[];
}

/** Параметр языка для DTO запросов витрины (читается декоратором @RequestLocale). */
export class LocaleQueryDto {
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' })
  @IsOptional()
  @IsIn(LOCALES as unknown as string[])
  locale?: Locale;
}

export class ChangedDto {
  @ApiProperty({ description: 'Было ли изменение (повтор того же действия ничего не меняет)' }) changed: boolean;
}

export class IdDto {
  @ApiProperty() id: string;
}
