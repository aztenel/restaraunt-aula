import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { MoneyDto } from '../../../../shared/infrastructure/http/api-types';
import { LOCALES, Locale } from '../../../../shared/kernel/translatable';
import { DEPOSIT_STATES, DepositOutcome, DepositState } from '../../domain/deposit-policy';
import { ALL_RESERVATION_STATUSES } from '../../domain/reservation-status';
import { ReservationStatus } from '../../public';
import { ImageDto, VenuePositionDto } from './common.dto';
import { DATE_RE, TIME_RE } from './reservations.dto';

const DEPOSIT_OUTCOMES = ['none', 'refunded', 'retained'] as const;
const AVAILABILITY_REASONS = ['no_capacity', 'occupied', 'past', 'too_soon', 'too_far', 'closed', 'not_accepting'] as const;

// ---------------------------------------------------------------- запросы

export class LocaleQueryDto {
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: Locale;
}

export class AvailabilityQueryDto extends LocaleQueryDto {
  @ApiProperty({ example: '2026-10-25', description: 'Локальная дата филиала' }) @Matches(DATE_RE) date: string;
  @ApiProperty({ example: '19:30', description: 'Локальное время начала' }) @Matches(TIME_RE) time: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @Type(() => Number) @IsInt() @Min(1) @Max(1000) guests: number;
  @ApiPropertyOptional({ example: 'vip_hall', description: 'Тип места (справочник типов)' }) @IsOptional() @IsString() @MaxLength(32) typeCode?: string;
  @ApiPropertyOptional({ minimum: 15, maximum: 1440, description: 'Длительность, минут (по умолчанию — правило места)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1440)
  durationMinutes?: number;
}

export class HallMapQueryDto extends LocaleQueryDto {
  @ApiPropertyOptional({ example: '2026-10-25', description: 'С датой, временем и гостями — у мест флаг available' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
  @ApiPropertyOptional({ example: '19:30' }) @IsOptional() @Matches(TIME_RE) time?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) guests?: number;
  @ApiPropertyOptional({ minimum: 15, maximum: 1440 }) @IsOptional() @Type(() => Number) @IsInt() @Min(15) @Max(1440) durationMinutes?: number;
}

export class GuestCustomerDto {
  @ApiProperty({ example: 'Айгерим' }) @IsString() @MinLength(1) @MaxLength(100) name: string;
  @ApiProperty({ example: '+7 701 123 45 67' }) @IsString() @MaxLength(32) phone: string;
  @ApiPropertyOptional({ example: 'aigerim@mail.kz' }) @IsOptional() @IsString() @MaxLength(200) email?: string;
}

export class ReservationConsentDto {
  @ApiProperty({ description: 'Согласие на обработку персональных данных (обязательно true)' }) @IsBoolean() personalData: boolean;
  @ApiPropertyOptional({ description: 'Согласие на рекламные рассылки (необязательно)' }) @IsOptional() @IsBoolean() marketing?: boolean;
}

export class BookReservationDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty() @IsUUID() venueId: string;
  @ApiProperty({ example: '2026-10-25' }) @Matches(DATE_RE) date: string;
  @ApiProperty({ example: '19:30' }) @Matches(TIME_RE) time: string;
  @ApiProperty({ minimum: 1, maximum: 1000 }) @IsInt() @Min(1) @Max(1000) guests: number;
  @ApiPropertyOptional({ minimum: 15, maximum: 1440, description: 'По умолчанию — правило места' })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(1440)
  durationMinutes?: number;
  @ApiProperty({ type: GuestCustomerDto }) @ValidateNested() @Type(() => GuestCustomerDto) customer: GuestCustomerDto;
  @ApiPropertyOptional({ description: 'Пожелания гостя' }) @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @ApiPropertyOptional({ example: 'День рождения' }) @IsOptional() @IsString() @MaxLength(100) occasion?: string;
  @ApiPropertyOptional({ description: 'Токен подтверждения телефона (если филиал требует SMS-код для броней без депозита)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  phoneVerificationToken?: string;
  @ApiProperty({ type: ReservationConsentDto }) @ValidateNested() @Type(() => ReservationConsentDto) consent: ReservationConsentDto;
  @ApiProperty({ enum: LOCALES, description: 'Язык уведомлений' }) @IsIn(LOCALES as unknown as string[]) locale: Locale;
  @ApiProperty({ description: 'Ключ идемпотентности (генерирует витрина на одну попытку оформления)' }) @IsString() @Length(8, 100) idempotencyKey: string;
}

export class GuestCancelReservationDto {
  @ApiPropertyOptional({ description: 'Причина (необязательно)' }) @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

// ---------------------------------------------------------------- ответы

export class PublicVenueRulesDto {
  @ApiProperty({ description: 'Сколько держится бронь без подтверждения / оплаты, минут' }) holdMinutes: number;
  @ApiProperty({ description: 'За сколько часов до начала можно отменить с возвратом депозита' }) cancellationDeadlineHours: number;
  @ApiProperty({ description: 'Бронь подтверждает персонал' }) requiresManualConfirmation: boolean;
}

export class PublicVenueSlotDto {
  @ApiProperty() venueId: string;
  @ApiProperty() hallId: string;
  @ApiProperty() hallName: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty({ example: 'table' }) typeCode: string;
  @ApiProperty() typeName: string;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true, description: 'Депозит (оплачивается онлайн при брони)' }) deposit: MoneyDto | null;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
  @ApiProperty() durationMinutes: number;
  @ApiProperty({ type: PublicVenueRulesDto }) rules: PublicVenueRulesDto;
  @ApiProperty({ type: VenuePositionDto }) position: VenuePositionDto;
  @ApiProperty({ type: [ImageDto] }) photos: ImageDto[];
}

export class AlternativeTimeDto {
  @ApiProperty({ example: '2026-10-25' }) date: string;
  @ApiProperty({ example: '18:30' }) time: string;
  @ApiProperty() start: Date;
  @ApiProperty({ type: [String], description: 'Свободные места на это время' }) venueIds: string[];
}

export class AvailabilityDto {
  @ApiProperty() branchId: string;
  @ApiProperty() branchSlug: string;
  @ApiProperty() date: string;
  @ApiProperty() time: string;
  @ApiProperty() guests: number;
  @ApiPropertyOptional({ type: Number, nullable: true }) durationMinutes: number | null;
  @ApiProperty({ description: 'Есть хотя бы одно свободное место' }) available: boolean;
  @ApiPropertyOptional({ enum: AVAILABILITY_REASONS, nullable: true, description: 'Почему мест нет' })
  reason: (typeof AVAILABILITY_REASONS)[number] | null;
  @ApiProperty({ type: [PublicVenueSlotDto], description: 'Только реально свободные места' }) venues: PublicVenueSlotDto[];
  @ApiProperty({ type: [AlternativeTimeDto], description: 'Ближайшее свободное время в тот же день, если мест нет' })
  alternatives: AlternativeTimeDto[];
}

export class PublicMapVenueDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() typeCode: string;
  @ApiProperty() typeName: string;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) deposit: MoneyDto | null;
  @ApiProperty({ type: VenuePositionDto }) position: VenuePositionDto;
  @ApiProperty({ description: 'Можно забронировать на сайте (иначе — по телефону)' }) bookableOnline: boolean;
  @ApiProperty({ type: [ImageDto] }) photos: ImageDto[];
  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'Свободно на запрошенное время; null — время не запрошено' }) available: boolean | null;
}

export class PublicHallDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() description: string;
  @ApiProperty() planWidth: number;
  @ApiProperty() planHeight: number;
  @ApiPropertyOptional({ type: ImageDto, nullable: true }) background: ImageDto | null;
  @ApiProperty({ type: [PublicMapVenueDto] }) venues: PublicMapVenueDto[];
}

export class PublicHallMapDto {
  @ApiProperty() branchId: string;
  @ApiProperty() branchSlug: string;
  @ApiProperty() acceptsReservations: boolean;
  @ApiProperty({ type: [PublicHallDto] }) halls: PublicHallDto[];
}

export class PublicReservationBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty() name: string;
  @ApiProperty() address: string;
  @ApiProperty() phone: string;
}

export class PublicReservationVenueDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() typeCode: string;
  @ApiProperty() typeName: string;
  @ApiProperty() hallName: string;
}

export class PublicDepositDto {
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ enum: DEPOSIT_STATES }) state: DepositState;
  @ApiProperty({ enum: DEPOSIT_OUTCOMES, description: 'Депозит возвращён или удержан (после отмены / неявки)' }) outcome: DepositOutcome;
  @ApiPropertyOptional({ type: String, nullable: true, example: 'pending' }) paymentStatus: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Страница оплаты (появляется асинхронно после создания платежа)' }) paymentUrl: string | null;
}

export class PublicPolicyDto {
  @ApiProperty() cancellationDeadlineHours: number;
  @ApiProperty() holdMinutes: number;
  @ApiProperty() requiresManualConfirmation: boolean;
  @ApiProperty({ description: 'Текст правил брони и отмены (настройка филиала)' }) text: string;
}

export class PublicReservationDto {
  @ApiProperty() token: string;
  @ApiProperty() number: string;
  @ApiProperty({ enum: ALL_RESERVATION_STATUSES }) status: ReservationStatus;
  @ApiProperty({ type: PublicReservationBranchDto }) branch: PublicReservationBranchDto;
  @ApiProperty({ type: PublicReservationVenueDto }) venue: PublicReservationVenueDto;
  @ApiProperty({ example: '2026-10-25' }) date: string;
  @ApiProperty({ example: '19:30' }) time: string;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
  @ApiProperty() durationMinutes: number;
  @ApiProperty() guests: number;
  @ApiPropertyOptional({ type: String, nullable: true }) customerName: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) occasion: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Бронь будет снята, если не подтвердят / не оплатят до этого момента' })
  holdExpiresAt: Date | null;
  @ApiPropertyOptional({ type: PublicDepositDto, nullable: true }) deposit: PublicDepositDto | null;
  @ApiProperty({ description: 'Гость может отменить бронь' }) canCancel: boolean;
  @ApiProperty({ description: 'Гость может (повторно) оплатить депозит' }) canPay: boolean;
  @ApiProperty({ description: 'Дедлайн бесплатной отмены (возврат депозита)' }) cancellationDeadline: Date;
  @ApiProperty({ enum: DEPOSIT_OUTCOMES, description: 'Что будет с депозитом при отмене сейчас' }) depositOutcomeIfCancelled: DepositOutcome;
  @ApiProperty({ type: PublicPolicyDto }) policy: PublicPolicyDto;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) cancelledAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) cancelReason: string | null;
}
