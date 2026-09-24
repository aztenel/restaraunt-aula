import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, MoneyInputDto, PageDtoOf, PageQueryDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { ALLERGEN_CODES } from '../../domain/allergens';
import { MAX_MODIFIER_SELECT, MAX_OPTIONS_PER_GROUP } from '../../domain/modifiers';
import { DishAvailability } from '../../public';
import { ImageDto, MissingTranslationDto, PhotoDto, queryBoolean } from './common.dto';

const AVAILABILITIES = Object.values(DishAvailability);

// ---------------------------------------------------------------- Категории

export class CategoryInputDto {
  @ApiPropertyOptional({ nullable: true, example: 'salaty', description: 'Человекочитаемый URL; не задан — транслитерация из названия' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string | null;

  @ApiProperty({ type: TranslatableDto, example: { ru: 'Салаты', kk: 'Салаттар' } })
  @ValidateNested()
  @Type(() => TranslatableDto)
  name: TranslatableDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true, description: 'SEO title (по умолчанию — название + филиал)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoTitle?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  seoDescription?: TranslatableDto | null;

  @ApiPropertyOptional({ description: 'Порядок в меню (по возрастанию)' })
  @IsOptional()
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean | null;
}

export class CategoryDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoTitle: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoDescription: TranslatableDto;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) image: ImageDto | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ description: 'Число блюд в категории' }) dishCount: number;
  @ApiProperty({ type: [MissingTranslationDto], description: 'Недостающие переводы (kk/ru)' }) missingTranslations: MissingTranslationDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ReorderDto {
  @ApiProperty({ type: [String], description: 'id в нужном порядке' })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids: string[];
}

// ---------------------------------------------------------------- Блюда

export class DishInputDto {
  @ApiPropertyOptional({ nullable: true, example: 'beshbarmak', description: 'Не задан — транслитерация из названия' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slug?: string | null;

  @ApiProperty() @IsUUID() categoryId: string;

  @ApiProperty({ type: TranslatableDto, example: { ru: 'Бешбармак', kk: 'Ет' } })
  @ValidateNested()
  @Type(() => TranslatableDto)
  name: TranslatableDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true, description: 'Состав' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  composition?: TranslatableDto | null;

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

  @ApiPropertyOptional({ nullable: true, description: 'Вес порции, г' }) @IsOptional() @IsInt() @Min(1) @Max(100_000) weightGrams?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Калорийность порции, ккал' }) @IsOptional() @IsInt() @Min(0) @Max(20_000) calories?: number | null;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isVegetarian?: boolean | null;
  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 3, description: 'Острота 0..3' }) @IsOptional() @IsInt() @Min(0) @Max(3) spicyLevel?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isHalal?: boolean | null;

  @ApiPropertyOptional({ type: [String], enum: ALLERGEN_CODES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @IsIn(ALLERGEN_CODES, { each: true })
  allergens?: string[] | null;

  @ApiPropertyOptional({ nullable: true, description: 'Общий код блюда в POS сети' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean | null;

  @ApiPropertyOptional({ type: [String], description: 'Группы модификаторов в порядке показа; не задано — без изменений' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('all', { each: true })
  modifierGroupIds?: string[] | null;
}

export class BranchPriceDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty({ enum: ['available', 'stopped'] }) availability: string;
  @ApiPropertyOptional({ nullable: true }) stoppedUntil: Date | null;
  @ApiPropertyOptional({ nullable: true }) sku: string | null;
}

export class DishDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() categoryId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) composition: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoTitle: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) seoDescription: TranslatableDto;
  @ApiPropertyOptional({ nullable: true }) weightGrams: number | null;
  @ApiPropertyOptional({ nullable: true }) calories: number | null;
  @ApiProperty() isVegetarian: boolean;
  @ApiProperty({ minimum: 0, maximum: 3 }) spicyLevel: number;
  @ApiProperty() isHalal: boolean;
  @ApiProperty({ type: [String], enum: ALLERGEN_CODES }) allergens: string[];
  @ApiPropertyOptional({ nullable: true }) sku: string | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [PhotoDto] }) photos: PhotoDto[];
  @ApiProperty({ type: [String] }) modifierGroupIds: string[];
  @ApiProperty({ type: [MissingTranslationDto] }) missingTranslations: MissingTranslationDto[];
  @ApiPropertyOptional({ type: [BranchPriceDto], description: 'Цены по доступным филиалам (в карточке блюда)' }) branchPrices?: BranchPriceDto[];
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class DishesPageDto extends PageDtoOf(DishDto) {}

export class DishListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по названию, slug, коду POS' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ description: 'Только блюда, которых нет в меню филиала (выбор «добавить в меню»)' })
  @IsOptional()
  @IsUUID()
  notInBranchId?: string;
}

export class PhotoOrderDto {
  @ApiProperty({ type: [String], description: 'Все id фото блюда в нужном порядке; первое — обложка' })
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  photoIds: string[];
}

// ---------------------------------------------------------------- Модификаторы

export class ModifierOptionInputDto {
  @ApiPropertyOptional({ description: 'id существующей опции; не задан — новая опция' }) @IsOptional() @IsUUID() id?: string | null;

  @ApiProperty({ type: TranslatableDto, example: { ru: 'Большая порция', kk: 'Үлкен порция' } })
  @ValidateNested()
  @Type(() => TranslatableDto)
  name: TranslatableDto;

  @ApiProperty({ type: MoneyInputDto, description: 'Доплата за опцию, тиыны (может быть 0)' })
  @ValidateNested()
  @Type(() => MoneyInputDto)
  price: MoneyInputDto;

  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() isDefault?: boolean | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean | null;
}

export class ModifierGroupInputDto {
  @ApiPropertyOptional({ nullable: true, example: 'portion-size', description: 'Код группы; не задан — из названия' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  code?: string | null;

  @ApiProperty({ type: TranslatableDto, example: { ru: 'Размер порции', kk: 'Порция көлемі' } })
  @ValidateNested()
  @Type(() => TranslatableDto)
  name: TranslatableDto;

  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;

  @ApiProperty({ minimum: 0, maximum: MAX_MODIFIER_SELECT, description: 'Минимум выбора; >= 1 — группа обязательная' })
  @IsInt()
  @Min(0)
  @Max(MAX_MODIFIER_SELECT)
  minSelect: number;

  @ApiProperty({ minimum: 1, maximum: MAX_MODIFIER_SELECT }) @IsInt() @Min(1) @Max(MAX_MODIFIER_SELECT) maxSelect: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(-1_000_000) @Max(1_000_000) sortOrder?: number | null;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean | null;

  @ApiProperty({ type: [ModifierOptionInputDto], description: 'Полный список опций: отсутствующие удаляются' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_OPTIONS_PER_GROUP)
  @ValidateNested({ each: true })
  @Type(() => ModifierOptionInputDto)
  options: ModifierOptionInputDto[];
}

export class ModifierOptionDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty() isDefault: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
}

export class ModifierGroupDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty() minSelect: number;
  @ApiProperty() maxSelect: number;
  @ApiProperty({ description: 'Обязательная группа (minSelect >= 1)' }) isRequired: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: [ModifierOptionDto] }) options: ModifierOptionDto[];
  @ApiProperty({ description: 'Число блюд с этой группой' }) dishCount: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

// ---------------------------------------------------------------- Меню филиала

export class AddMenuItemDto {
  @ApiProperty() @IsUUID() dishId: string;

  @ApiProperty({ type: MoneyInputDto, description: 'Цена блюда в филиале, тиыны' })
  @ValidateNested()
  @Type(() => MoneyInputDto)
  price: MoneyInputDto;

  @ApiPropertyOptional({ nullable: true, description: 'Код POS филиала (если отличается от общего кода блюда)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string | null;
}

export class SetPriceDto {
  @ApiProperty({ type: MoneyInputDto })
  @ValidateNested()
  @Type(() => MoneyInputDto)
  price: MoneyInputDto;

  @ApiPropertyOptional({ nullable: true, description: 'Код POS филиала; не передан — без изменений, null — сбросить' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sku?: string | null;
}

export class BulkPriceItemDto {
  @ApiProperty() @IsUUID() dishId: string;

  @ApiProperty({ type: MoneyInputDto })
  @ValidateNested()
  @Type(() => MoneyInputDto)
  price: MoneyInputDto;
}

export class BulkPricesDto {
  @ApiProperty({ type: [BulkPriceItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkPriceItemDto)
  items: BulkPriceItemDto[];
}

export class BulkPricesResultDto {
  @ApiProperty() updated: number;
  @ApiProperty() unchanged: number;
}

export class CopyMenuDto {
  @ApiProperty({ description: 'Филиал-источник' }) @IsUUID() fromBranchId: string;
  @ApiPropertyOptional({ default: false, description: 'Перезаписать цены блюд, которые уже есть в меню филиала' })
  @IsOptional()
  @IsBoolean()
  overwritePrices?: boolean;
}

export class CopyMenuResultDto {
  @ApiProperty() added: number;
  @ApiProperty() updated: number;
  @ApiProperty() unchanged: number;
}

export class SetAvailabilityDto {
  @ApiProperty({ description: 'true — вернуть в продажу, false — поставить в стоп-лист' }) @IsBoolean() available: boolean;

  @ApiPropertyOptional({ nullable: true, description: 'Стоп до момента (ISO 8601), затем автоматический возврат; не задан — до ручного возврата' })
  @IsOptional()
  @IsISO8601({ strict: true })
  until?: string | null;

  @ApiPropertyOptional({ description: 'Стоп до конца дня (полночь по времени филиала)' }) @IsOptional() @IsBoolean() untilEndOfDay?: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'Закончилась конина' }) @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}

export class BranchMenuItemDto {
  @ApiProperty() branchId: string;
  @ApiProperty() dishId: string;
  @ApiProperty() dishSlug: string;
  @ApiProperty({ type: TranslatableDto }) dishName: TranslatableDto;
  @ApiProperty() categoryId: string;
  @ApiProperty() dishIsActive: boolean;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) photo: ImageDto | null;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
  @ApiProperty({ enum: ['available', 'stopped'] }) availability: string;
  @ApiProperty({ enum: AVAILABILITIES, description: 'Как видно на витрине с учётом настройки филиала' }) displayAvailability: string;
  @ApiPropertyOptional({ nullable: true }) stoppedUntil: Date | null;
  @ApiPropertyOptional({ nullable: true }) stopReason: string | null;
  @ApiPropertyOptional({ nullable: true, enum: ['manual', 'pos'] }) stopSource: string | null;
  @ApiPropertyOptional({ nullable: true }) stoppedAt: Date | null;
  @ApiPropertyOptional({ nullable: true, description: 'Код POS филиала' }) sku: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Код, который уходит в POS' }) effectiveSku: string | null;
  @ApiPropertyOptional({ nullable: true }) updatedBy: string | null;
  @ApiProperty() updatedAt: Date;
}

export class BranchMenuPageDto extends PageDtoOf(BranchMenuItemDto) {}

export class BranchMenuQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: ['available', 'stopped'] }) @IsOptional() @IsIn(['available', 'stopped']) availability?: 'available' | 'stopped';
}

export class AvailabilityResultDto {
  @ApiProperty() changed: boolean;
  @ApiProperty({ type: BranchMenuItemDto }) item: BranchMenuItemDto;
}

// ---------------------------------------------------------------- Справочники и отчёты

export class AllergenRefDto {
  @ApiProperty({ enum: ALLERGEN_CODES }) code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
}

export class TranslationGapDto {
  @ApiProperty({ enum: ['category', 'dish', 'modifier_group', 'modifier_option', 'banner', 'promotion', 'page'] }) entityType: string;
  @ApiProperty() entityId: string;
  @ApiProperty() label: string;
  @ApiProperty() field: string;
  @ApiProperty({ type: [String], enum: ['kk', 'ru', 'en'] }) missing: string[];
}

export class TranslationSummaryDto {
  @ApiProperty() entityType: string;
  @ApiProperty() total: number;
  @ApiProperty() incomplete: number;
}

export class TranslationReportDto {
  @ApiProperty({ type: [String], enum: ['kk', 'ru', 'en'] }) locales: string[];
  @ApiProperty({ type: [TranslationSummaryDto] }) summary: TranslationSummaryDto[];
  @ApiProperty({ type: [TranslationGapDto] }) items: TranslationGapDto[];
}

export class TranslationReportQueryDto {
  @ApiPropertyOptional({ description: 'Языки через запятую, по умолчанию kk,ru', example: 'kk,ru' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  locales?: string;

  @ApiPropertyOptional({ enum: ['category', 'dish', 'modifier_group', 'modifier_option', 'banner', 'promotion', 'page'] })
  @IsOptional()
  @IsIn(['category', 'dish', 'modifier_group', 'modifier_option', 'banner', 'promotion', 'page'])
  entityType?: string;
}
