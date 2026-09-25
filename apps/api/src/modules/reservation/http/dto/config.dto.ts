import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MoneyDto, MoneyInputDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { MAX_VENUE_CAPACITY, PLAN_LIMITS } from '../../domain/venue';
import {
  ImageDto,
  VenuePositionDto,
  VenuePositionInputDto,
  VenueRuleOverridesDto,
  VenueRulesDto,
  VenueRulesPatchDto,
} from './common.dto';

// ---------------------------------------------------------------- типы мест

export class VenueTypeDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'vip_hall' }) code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ type: VenueRulesDto, description: 'Правила брони по умолчанию для мест этого типа' }) rules: VenueRulesDto;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CreateVenueTypeDto {
  @ApiProperty({ example: 'vip_hall', description: 'Латиница в нижнем регистре, цифры, «_»' }) @IsString() @MaxLength(32) code: string;
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiProperty({ type: VenueRulesDto }) @ValidateNested() @Type(() => VenueRulesDto) rules: VenueRulesDto;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateVenueTypeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) code?: string;
  @ApiPropertyOptional({ type: TranslatableDto }) @IsOptional() @ValidateNested() @Type(() => TranslatableDto) name?: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiPropertyOptional({ type: VenueRulesPatchDto }) @IsOptional() @ValidateNested() @Type(() => VenueRulesPatchDto) rules?: VenueRulesPatchDto;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------------------------------------------------------- залы

export class HallDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ example: 'main' }) code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty({ description: 'Ширина плана зала, условные единицы' }) planWidth: number;
  @ApiProperty({ description: 'Высота плана зала, условные единицы' }) planHeight: number;
  @ApiPropertyOptional({ type: ImageDto, nullable: true, description: 'Фон плана зала' }) background: ImageDto | null;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class HallsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class CreateHallDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ example: 'main' }) @IsString() @MaxLength(32) code: string;
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiPropertyOptional({ default: 1000, minimum: PLAN_LIMITS.min, maximum: PLAN_LIMITS.max })
  @IsOptional()
  @IsInt()
  @Min(PLAN_LIMITS.min)
  @Max(PLAN_LIMITS.max)
  planWidth?: number;
  @ApiPropertyOptional({ default: 600, minimum: PLAN_LIMITS.min, maximum: PLAN_LIMITS.max })
  @IsOptional()
  @IsInt()
  @Min(PLAN_LIMITS.min)
  @Max(PLAN_LIMITS.max)
  planHeight?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateHallDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) code?: string;
  @ApiPropertyOptional({ type: TranslatableDto }) @IsOptional() @ValidateNested() @Type(() => TranslatableDto) name?: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiPropertyOptional({ minimum: PLAN_LIMITS.min, maximum: PLAN_LIMITS.max }) @IsOptional() @IsInt() @Min(PLAN_LIMITS.min) @Max(PLAN_LIMITS.max) planWidth?: number;
  @ApiPropertyOptional({ minimum: PLAN_LIMITS.min, maximum: PLAN_LIMITS.max }) @IsOptional() @IsInt() @Min(PLAN_LIMITS.min) @Max(PLAN_LIMITS.max) planHeight?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------------------------------------------------------- места

export class VenueDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty() hallId: string;
  @ApiProperty({ type: TranslatableDto }) hallName: TranslatableDto;
  @ApiProperty() typeId: string;
  @ApiProperty({ example: 'table' }) typeCode: string;
  @ApiProperty({ type: TranslatableDto }) typeName: TranslatableDto;
  @ApiProperty({ example: 'T4' }) code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) description: TranslatableDto;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true, description: 'Минимальный депозит (онлайн-предоплата); null — без депозита' })
  deposit: MoneyDto | null;
  @ApiProperty({ type: VenueRuleOverridesDto, description: 'Переопределения правил типа' }) ruleOverrides: VenueRuleOverridesDto;
  @ApiProperty({ type: VenueRulesDto, description: 'Действующие правила (тип + переопределения)' }) rules: VenueRulesDto;
  @ApiProperty({ type: VenuePositionDto }) position: VenuePositionDto;
  @ApiProperty({ type: [ImageDto] }) photos: ImageDto[];
  @ApiProperty() sortOrder: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ description: 'Доступно для брони: активны место, зал и тип' }) isBookable: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class VenuesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hallId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() typeId?: string;
}

export class CreateVenueDto {
  @ApiProperty() @IsUUID() hallId: string;
  @ApiProperty() @IsUUID() typeId: string;
  @ApiProperty({ example: 'T4', description: 'Код места в филиале (латиница, цифры, «-», «_»)' }) @IsString() @MaxLength(32) code: string;
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiProperty({ minimum: 1, maximum: MAX_VENUE_CAPACITY }) @IsInt() @Min(1) @Max(MAX_VENUE_CAPACITY) capacityMin: number;
  @ApiProperty({ minimum: 1, maximum: MAX_VENUE_CAPACITY }) @IsInt() @Min(1) @Max(MAX_VENUE_CAPACITY) capacityMax: number;
  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'Депозит; null — без депозита' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  deposit?: MoneyInputDto | null;
  @ApiPropertyOptional({ type: VenueRuleOverridesDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => VenueRuleOverridesDto)
  rules?: VenueRuleOverridesDto | null;
  @ApiPropertyOptional({ type: VenuePositionInputDto }) @IsOptional() @ValidateNested() @Type(() => VenuePositionInputDto) position?: VenuePositionInputDto;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateVenueDto {
  @ApiPropertyOptional({ description: 'Пересадить в другой зал того же филиала' }) @IsOptional() @IsUUID() hallId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() typeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) code?: string;
  @ApiPropertyOptional({ type: TranslatableDto }) @IsOptional() @ValidateNested() @Type(() => TranslatableDto) name?: TranslatableDto;
  @ApiPropertyOptional({ type: TranslatableDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  description?: TranslatableDto | null;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_VENUE_CAPACITY }) @IsOptional() @IsInt() @Min(1) @Max(MAX_VENUE_CAPACITY) capacityMin?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_VENUE_CAPACITY }) @IsOptional() @IsInt() @Min(1) @Max(MAX_VENUE_CAPACITY) capacityMax?: number;
  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'null — убрать депозит' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  deposit?: MoneyInputDto | null;
  @ApiPropertyOptional({ type: VenueRuleOverridesDto, nullable: true, description: 'Полная замена переопределений; null — как у типа' })
  @IsOptional()
  @ValidateNested()
  @Type(() => VenueRuleOverridesDto)
  rules?: VenueRuleOverridesDto | null;
  @ApiPropertyOptional({ type: VenuePositionInputDto }) @IsOptional() @ValidateNested() @Type(() => VenuePositionInputDto) position?: VenuePositionInputDto;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10_000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

// ---------------------------------------------------------------- настройки филиала

export class ReservationSettingsDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ example: 3, description: 'Напоминание гостю за N часов до начала (0 — не напоминать)' }) reminderHoursBefore: number;
  @ApiProperty({ example: 60, description: 'Бронь на витрине — не раньше чем через N минут' }) minLeadMinutes: number;
  @ApiProperty({ example: 60, description: 'На сколько дней вперёд можно бронировать на витрине' }) maxDaysAhead: number;
  @ApiProperty({ type: TranslatableDto, description: 'Текст правил брони и отмены для гостя' }) policyText: TranslatableDto;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
}

export class UpdateReservationSettingsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 72 }) @IsOptional() @IsInt() @Min(0) @Max(72) reminderHoursBefore?: number;
  @ApiPropertyOptional({ minimum: 0, maximum: 10_080 }) @IsOptional() @IsInt() @Min(0) @Max(10_080) minLeadMinutes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 365 }) @IsOptional() @IsInt() @Min(1) @Max(365) maxDaysAhead?: number;
  @ApiPropertyOptional({ type: TranslatableDto }) @IsOptional() @ValidateNested() @Type(() => TranslatableDto) policyText?: TranslatableDto;
}
