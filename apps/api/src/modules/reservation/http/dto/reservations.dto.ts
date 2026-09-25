import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, PageQueryDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { LOCALES, Locale } from '../../../../shared/kernel/translatable';
import { DEPOSIT_STATES, DepositOutcome, DepositState } from '../../domain/deposit-policy';
import { ALL_RESERVATION_STATUSES } from '../../domain/reservation-status';
import { ReservationKind, ReservationSource, ReservationStatus } from '../../public';
import { ImageDto, TimeRangeDto, VenuePositionDto, VenueRulesDto } from './common.dto';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KINDS = ['regular', 'banquet'] as const;
const SOURCES = ['web', 'admin', 'banquet'] as const;
const DEPOSIT_OUTCOMES = ['none', 'refunded', 'retained'] as const;
const CANCELLED_BY = ['guest', 'staff', 'system', 'banquet'] as const;

/** 'true'/'false' из строки запроса -> boolean (остальное отклонит @IsBoolean). */
export const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);
/** 'a,b' -> ['a', 'b']. */
const toList = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.split(',').map((s) => s.trim()).filter(Boolean) : value);

// ---------------------------------------------------------------- ответы

export class ReservationVenueRefDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() hallId: string;
  @ApiProperty({ type: TranslatableDto }) hallName: TranslatableDto;
  @ApiProperty() typeCode: string;
  @ApiProperty({ type: TranslatableDto }) typeName: TranslatableDto;
}

export class ReservationCustomerDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Гость в базе гостей' }) id: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) name: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '+77011234567' }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
}

export class ReservationSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'GL-R-2026-000123' }) number: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ enum: KINDS, description: 'regular — бронь гостя, banquet — зал занят под банкет' }) kind: ReservationKind;
  @ApiProperty({ enum: ALL_RESERVATION_STATUSES }) status: ReservationStatus;
  @ApiProperty({ enum: SOURCES }) source: ReservationSource;
  @ApiProperty({ type: ReservationVenueRefDto }) venue: ReservationVenueRefDto;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
  @ApiProperty({ description: 'Конец занятости места: конец брони + буфер уборки' }) blockedUntil: Date;
  @ApiProperty({ example: '2026-10-25', description: 'Локальная дата начала (часовой пояс филиала)' }) date: string;
  @ApiProperty({ example: '19:30' }) time: string;
  @ApiProperty() durationMinutes: number;
  @ApiProperty() guests: number;
  @ApiProperty({ type: ReservationCustomerDto }) customer: ReservationCustomerDto;
  @ApiPropertyOptional({ type: String, nullable: true }) comment: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) occasion: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Служебная заметка персонала' }) note: string | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) deposit: MoneyDto | null;
  @ApiProperty({ enum: DEPOSIT_STATES }) depositState: DepositState;
  @ApiProperty({ enum: DEPOSIT_OUTCOMES }) depositOutcome: DepositOutcome;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Бронь будет снята, если не подтвердят / не оплатят до этого момента' })
  holdExpiresAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) banquetRequestId: string | null;
  @ApiProperty({ description: 'Требует отметки «пришли / не пришли»' }) needsMark: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ enum: ALL_RESERVATION_STATUSES, isArray: true, description: 'Переходы, доступные сотруднику сейчас' })
  allowedTransitions: ReservationStatus[];
  @ApiProperty({ description: 'Можно перенести / пересадить' }) canReschedule: boolean;
}

export class ReservationsPageDto {
  @ApiProperty({ type: [ReservationSummaryDto] }) items: ReservationSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class DepositPaymentDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'pending' }) status: string;
  @ApiProperty({ type: MoneyDto }) amount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) refundedAmount: MoneyDto;
  @ApiPropertyOptional({ type: String, nullable: true }) paymentUrl: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) paidAt: Date | null;
}

export class StatusHistoryDto {
  @ApiPropertyOptional({ enum: ALL_RESERVATION_STATUSES, nullable: true }) from: ReservationStatus | null;
  @ApiProperty({ enum: ALL_RESERVATION_STATUSES }) to: ReservationStatus;
  @ApiPropertyOptional({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ enum: DEPOSIT_OUTCOMES }) depositOutcome: DepositOutcome;
  @ApiProperty({ example: 'staff' }) actorKind: string;
  @ApiProperty() actorName: string;
  @ApiProperty() occurredAt: Date;
}

export class ReservationDetailDto extends ReservationSummaryDto {
  @ApiProperty({ type: VenueRulesDto, description: 'Правила брони (снимок на момент брони / переноса)' }) rules: VenueRulesDto;
  @ApiProperty({ description: 'Дедлайн бесплатной отмены' }) cancellationDeadline: Date;
  @ApiProperty({ enum: DEPOSIT_OUTCOMES, description: 'Исход депозита при отмене сейчас по правилу' }) depositOutcomeIfCancelled: DepositOutcome;
  @ApiPropertyOptional({ type: DepositPaymentDto, nullable: true }) depositPayment: DepositPaymentDto | null;
  @ApiPropertyOptional({ type: String, nullable: true }) depositWaiveReason: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) depositPaidAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true }) cancelReason: string | null;
  @ApiPropertyOptional({ enum: CANCELLED_BY, nullable: true }) cancelledBy: (typeof CANCELLED_BY)[number] | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) confirmedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) arrivedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) noShowAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) cancelledAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) expiredAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) reminderSentAt: Date | null;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Ссылка на страницу брони гостя' }) manageUrl: string | null;
  @ApiProperty({ type: [StatusHistoryDto] }) history: StatusHistoryDto[];
}

export class TimelineItemDto {
  @ApiProperty() reservationId: string;
  @ApiProperty() number: string;
  @ApiProperty({ enum: KINDS }) kind: ReservationKind;
  @ApiProperty({ enum: ALL_RESERVATION_STATUSES }) status: ReservationStatus;
  @ApiProperty({ description: 'Занимает место' }) blocking: boolean;
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
  @ApiProperty() blockedUntil: Date;
  @ApiProperty() guests: number;
  @ApiPropertyOptional({ type: String, nullable: true }) customerName: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) customerPhone: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) banquetRequestId: string | null;
  @ApiProperty({ enum: DEPOSIT_STATES }) depositState: DepositState;
  @ApiProperty() needsMark: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true, description: 'Бронь будет снята, если не подтвердят / не оплатят до этого момента' })
  holdExpiresAt: Date | null;
}

export class TimelineVenueDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() typeCode: string;
  @ApiProperty({ type: TranslatableDto }) typeName: TranslatableDto;
  @ApiProperty() capacityMin: number;
  @ApiProperty() capacityMax: number;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) deposit: MoneyDto | null;
  @ApiProperty({ type: VenuePositionDto }) position: VenuePositionDto;
  @ApiProperty() isActive: boolean;
  @ApiProperty() bookableOnline: boolean;
  @ApiProperty({ type: VenueRulesDto, description: 'Действующие правила места: длительность, уборка, удержание, шаг сетки' }) rules: VenueRulesDto;
  @ApiProperty({ type: [TimelineItemDto] }) items: TimelineItemDto[];
}

export class TimelineHallDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty() planWidth: number;
  @ApiProperty() planHeight: number;
  @ApiProperty() isActive: boolean;
  @ApiPropertyOptional({ type: ImageDto, nullable: true, description: 'Подложка плана зала' }) background: ImageDto | null;
  @ApiProperty({ type: [TimelineVenueDto] }) venues: TimelineVenueDto[];
}

export class TimelineDto {
  @ApiProperty() branchId: string;
  @ApiProperty({ example: '2026-10-25' }) date: string;
  @ApiProperty({ example: 'Asia/Almaty' }) timezone: string;
  @ApiProperty({ description: 'Начало локальных суток (UTC)' }) from: Date;
  @ApiProperty({ description: 'Конец локальных суток (UTC)' }) to: Date;
  @ApiProperty({ type: [TimeRangeDto], description: 'Часы работы филиала в этот день' }) openingRanges: TimeRangeDto[];
  @ApiProperty({ type: [TimelineHallDto] }) halls: TimelineHallDto[];
}

// ---------------------------------------------------------------- запросы

export class AdminReservationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ example: '2026-10-25', description: 'Начало брони с даты (локальной, включительно)' })
  @IsOptional()
  @Matches(DATE_RE)
  dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Начало брони по дату (включительно)' }) @IsOptional() @Matches(DATE_RE) dateTo?: string;
  @ApiPropertyOptional({ type: String, description: `Статусы через запятую: ${ALL_RESERVATION_STATUSES.join(', ')}`, example: 'pending,awaiting_deposit' })
  @IsOptional()
  @Transform(toList)
  @IsIn(ALL_RESERVATION_STATUSES, { each: true })
  status?: ReservationStatus[];
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: ReservationKind;
  @ApiPropertyOptional({ enum: SOURCES }) @IsOptional() @IsIn(SOURCES as unknown as string[]) source?: ReservationSource;
  @ApiPropertyOptional() @IsOptional() @IsUUID() venueId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() hallId?: string;
  @ApiPropertyOptional({ description: 'Номер брони, телефон или имя гостя' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ description: 'Только очередь «требует отметки»: подтверждённые брони, которые уже начались' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  needsMark?: boolean;
}

export class TimelineQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ example: '2026-10-25', description: 'Локальная дата филиала' }) @Matches(DATE_RE) date: string;
}

export class StaffCustomerDto {
  @ApiPropertyOptional({ example: 'Айгерим' }) @IsOptional() @IsString() @MaxLength(100) name?: string;
  @ApiProperty({ example: '+7 701 123 45 67' }) @IsString() @MaxLength(32) phone: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) email?: string;
}

export class StaffDepositDto {
  @ApiProperty({ enum: ['payment_link', 'waive'], description: 'payment_link — отправить гостю ссылку на оплату; waive — без депозита (причина обязательна)' })
  @IsIn(['payment_link', 'waive'])
  mode: 'payment_link' | 'waive';
  @ApiPropertyOptional({ description: 'Причина отказа от депозита (журнал действий)' }) @IsOptional() @IsString() @MaxLength(500) waiveReason?: string;
}

export class StaffConsentDto {
  @ApiPropertyOptional({ description: 'Гость дал согласие на обработку ПД по телефону' }) @IsOptional() @IsBoolean() personalData?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() marketing?: boolean;
}

export class CreateStaffReservationDto {
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
  @ApiProperty({ type: StaffCustomerDto }) @ValidateNested() @Type(() => StaffCustomerDto) customer: StaffCustomerDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
  @ApiPropertyOptional({ example: 'День рождения' }) @IsOptional() @IsString() @MaxLength(100) occasion?: string;
  @ApiPropertyOptional({ description: 'Служебная заметка (гость не видит)' }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru', description: 'Язык уведомлений гостю' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: Locale;
  @ApiPropertyOptional({ type: StaffDepositDto, description: 'Обязательно, если у места есть депозит' })
  @IsOptional()
  @ValidateNested()
  @Type(() => StaffDepositDto)
  deposit?: StaffDepositDto;
  @ApiPropertyOptional({ type: StaffConsentDto }) @IsOptional() @ValidateNested() @Type(() => StaffConsentDto) consent?: StaffConsentDto;
  @ApiPropertyOptional({ description: 'Ключ идемпотентности (повтор не создаёт вторую бронь)' }) @IsOptional() @IsString() @Length(8, 100) idempotencyKey?: string;
}

export class ConfirmReservationDto {
  @ApiPropertyOptional({ description: 'Подтвердить без оплаченного депозита — отказ от депозита с причиной' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  waiveDepositReason?: string;
}

export class CancelReservationDto {
  @ApiProperty({ example: 'Гость попросил отменить по телефону' }) @IsString() @MaxLength(500) reason: string;
  @ApiPropertyOptional({ enum: ['refund', 'retain'], description: 'Решение по оплаченному депозиту; по умолчанию — правило отмены места' })
  @IsOptional()
  @IsIn(['refund', 'retain'])
  depositDecision?: 'refund' | 'retain';
}

export class RescheduleReservationDto {
  @ApiPropertyOptional({ description: 'Новое место (того же филиала)' }) @IsOptional() @IsUUID() venueId?: string;
  @ApiPropertyOptional({ example: '2026-10-26' }) @IsOptional() @Matches(DATE_RE) date?: string;
  @ApiPropertyOptional({ example: '20:00' }) @IsOptional() @Matches(TIME_RE) time?: string;
  @ApiPropertyOptional({ minimum: 15, maximum: 1440 }) @IsOptional() @IsInt() @Min(15) @Max(1440) durationMinutes?: number;
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 }) @IsOptional() @IsInt() @Min(1) @Max(1000) guests?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
