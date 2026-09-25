import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { MoneyDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { VenuePositionDto, VenueRulesDto } from './common.dto';
import { AlternativeTimeDto, AVAILABILITY_REASONS } from './public.dto';
import { DATE_RE, TIME_RE } from './reservations.dto';

/** Свободные места для оператора: бронь по телефону и перенос. */
export class AdminAvailabilityQueryDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() branchId: string;
  @ApiProperty({ example: '2026-10-25', description: 'Локальная дата филиала' }) @Matches(DATE_RE) date: string;
  @ApiProperty({ example: '19:30', description: 'Локальное время начала' }) @Matches(TIME_RE) time: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000) guests: number;
  @ApiPropertyOptional({ minimum: 15, maximum: 1440, description: 'Длительность, минут (по умолчанию — правило места)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  durationMinutes?: number;
  @ApiPropertyOptional({ example: 'vip_hall', description: 'Тип места' }) @IsOptional() @IsString() @MaxLength(32) typeCode?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Только места зала' }) @IsOptional() @IsUUID() hallId?: string;
  @ApiPropertyOptional({ format: 'uuid', description: 'Не учитывать занятость этой брони (перенос / пересадка)' })
  @IsOptional()
  @IsUUID()
  excludeReservationId?: string;
}

export class AdminVenueSlotDto {
  @ApiProperty() venueId: string;
  @ApiProperty() hallId: string;
  @ApiProperty({ type: TranslatableDto }) hallName: TranslatableDto;
  @ApiProperty() code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() typeCode: string;
  @ApiProperty({ type: TranslatableDto }) typeName: TranslatableDto;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiProperty({ description: 'Гостей меньше минимальной вместимости места (оператору разрешено)' }) belowMinimum: boolean;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) deposit: MoneyDto | null;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
  @ApiProperty({ description: 'Конец занятости места: конец брони + буфер уборки' }) blockedUntil: Date;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ type: VenueRulesDto, description: 'Действующие правила места' }) rules: VenueRulesDto;
  @ApiProperty({ description: 'Можно бронировать на витрине (false — только через оператора)' }) bookableOnline: boolean;
  @ApiProperty({ type: VenuePositionDto }) position: VenuePositionDto;
}

export class AdminAvailabilityDto {
  @ApiProperty() branchId: string;
  @ApiProperty() date: string;
  @ApiProperty() time: string;
  @ApiProperty() guests: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMinutes: number | null;
  @ApiProperty({ description: 'Есть хотя бы одно свободное место' }) available: boolean;
  @ApiPropertyOptional({ enum: AVAILABILITY_REASONS, nullable: true, description: 'Почему мест нет (past / closed / occupied / no_capacity)' })
  reason: (typeof AVAILABILITY_REASONS)[number] | null;
  @ApiProperty({ type: [AdminVenueSlotDto], description: 'Свободные места, включая места только для брони через оператора' })
  venues: AdminVenueSlotDto[];
  @ApiProperty({ type: [AlternativeTimeDto], description: 'Ближайшее свободное время в тот же день, если мест нет' })
  alternatives: AlternativeTimeDto[];
}
