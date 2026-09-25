import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MoneyDto, PageQueryDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { LOCALES, Locale } from '../../../shared/kernel/translatable';
import { CONSENT_KINDS } from '../domain/consent';
import { EXPORT_FORMATS, EXPORT_PURPOSES, ExportFormat, ExportPurpose } from '../domain/export';
import { ACTIVITY_TYPES } from '../domain/history';
import { ConsentKind } from '../public';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SORTS = ['lastActivity', 'totalSpent', 'name', 'firstSeen'] as const;

/** 'true'/'false' из строки запроса -> boolean (остальное оставляем как есть — его отклонит @IsBoolean). */
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

// ---------------------------------------------------------------- витрина: согласия и подтверждение телефона

export class ConsentKindParamDto {
  @ApiProperty({ enum: CONSENT_KINDS })
  @IsIn(CONSENT_KINDS as unknown as string[])
  kind: ConsentKind;
}

export class PublicConsentTextDto {
  @ApiProperty({ enum: CONSENT_KINDS }) kind: ConsentKind;
  @ApiProperty({ example: '2026-09-25', description: 'Версия текста — передаётся обратно вместе с согласием' }) version: string;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
  @ApiProperty({ description: 'Текст согласия на языке запроса' }) text: string;
  @ApiProperty() publishedAt: Date;
}

export class StartPhoneVerificationDto {
  @ApiProperty({ example: '+7 701 123 45 67' })
  @IsString()
  @MaxLength(32)
  phone: string;

  @ApiPropertyOptional({ enum: LOCALES, default: 'ru', description: 'Язык SMS' })
  @IsOptional()
  @IsIn(LOCALES as unknown as string[])
  locale?: Locale;
}

export class PhoneVerificationStartedDto {
  @ApiProperty() verificationId: string;
  @ApiProperty({ description: 'Срок действия кода' }) expiresAt: Date;
  @ApiProperty({ example: 60, description: 'Через сколько секунд можно запросить код повторно' }) resendAfterSeconds: number;
}

export class VerifyPhoneCodeDto {
  @ApiProperty({ example: '1234', description: 'Код из SMS (4 цифры)' })
  @IsString()
  @MaxLength(12)
  code: string;
}

export class PhoneVerifiedDto {
  @ApiProperty({ description: 'Токен подтверждения телефона (передаётся при оформлении заказа/брони), действует 30 минут' })
  token: string;
  @ApiProperty({ example: '+77011234567' }) phone: string;
  @ApiProperty() expiresAt: Date;
}

// ---------------------------------------------------------------- админка: гости

export class CustomerDto {
  @ApiProperty() id: string;
  @ApiPropertyOptional({ type: String, nullable: true, example: '+77011234567', description: 'null у обезличенного гостя' }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) name: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
  @ApiProperty({ enum: LOCALES }) locale: Locale;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '1990-05-17' }) birthday: string | null;
  @ApiProperty({ type: [String], example: ['regular', 'vip'] }) tags: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) allergies: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) preferences: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) notes: string | null;
  @ApiProperty() personalDataConsent: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) personalDataConsentVersion: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) personalDataConsentAt: Date | null;
  @ApiProperty() marketingConsent: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) marketingConsentVersion: string | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) marketingConsentAt: Date | null;
  @ApiProperty() ordersCount: number;
  @ApiProperty() completedOrdersCount: number;
  @ApiProperty({ type: MoneyDto, description: 'Сумма покупок за всё время: выполненные заказы, проведённые банкеты, сертификаты' })
  totalSpent: MoneyDto;
  @ApiProperty() reservationsCount: number;
  @ApiProperty() noShowCount: number;
  @ApiProperty() banquetsCount: number;
  @ApiProperty() firstSeenAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastActivityAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) anonymizedAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class CustomersPageDto {
  @ApiProperty({ type: [CustomerDto] }) items: CustomerDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class CustomersQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Поиск по телефону (цифры), имени или email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Тег (несколько — через запятую, нужны все)', example: 'regular' })
  @IsOptional()
  @IsString()
  @MaxLength(400)
  tag?: string;

  @ApiPropertyOptional({ description: 'Сумма покупок от, тиыны' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spentMin?: number;

  @ApiPropertyOptional({ description: 'Сумма покупок до, тиыны' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  spentMax?: number;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Последняя активность с (локальная дата)' })
  @IsOptional()
  @Matches(DATE_RE)
  lastActivityFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Последняя активность по (включительно)' })
  @IsOptional()
  @Matches(DATE_RE)
  lastActivityTo?: string;

  @ApiPropertyOptional({ description: 'Была активность в филиале' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasBanquet?: boolean;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  marketingConsent?: boolean;

  @ApiPropertyOptional({ description: 'Применить сохранённый сегмент (фильтры запроса уточняют его)' })
  @IsOptional()
  @IsUUID()
  segmentId?: string;

  @ApiPropertyOptional({ type: Boolean, default: false, description: 'Показывать обезличенных' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  includeAnonymized?: boolean;

  @ApiPropertyOptional({ enum: SORTS, default: 'lastActivity' })
  @IsOptional()
  @IsIn(SORTS as unknown as string[])
  sort?: (typeof SORTS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

/** Фильтр гостей в теле запроса (сегменты, выгрузки). */
export class CustomerFilterDto {
  @ApiPropertyOptional({ description: 'Поиск по телефону, имени или email' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ type: [String], description: 'Все теги должны быть у гостя' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Сумма покупок от, тиыны' })
  @IsOptional()
  @IsInt()
  @Min(0)
  spentMin?: number;

  @ApiPropertyOptional({ description: 'Сумма покупок до, тиыны' })
  @IsOptional()
  @IsInt()
  @Min(0)
  spentMax?: number;

  @ApiPropertyOptional({ example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE_RE)
  lastActivityFrom?: string;

  @ApiPropertyOptional({ example: '2026-09-30' })
  @IsOptional()
  @Matches(DATE_RE)
  lastActivityTo?: string;

  @ApiPropertyOptional({ description: 'Была активность в филиале' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasBanquet?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  marketingConsent?: boolean;
}

export class CustomerDetailQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'Период истории и итогов: с (локальная дата)' })
  @IsOptional()
  @Matches(DATE_RE)
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Период: по (включительно)' })
  @IsOptional()
  @Matches(DATE_RE)
  to?: string;
}

export class ConsentRecordDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: CONSENT_KINDS }) kind: ConsentKind;
  @ApiProperty() granted: boolean;
  @ApiProperty() textVersion: string;
  @ApiProperty({ enum: ['web', 'admin', 'phone'] }) source: string;
  @ApiPropertyOptional({ type: String, nullable: true }) ip: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Сотрудник, внёсший согласие' }) recordedBy: string | null;
  @ApiProperty() recordedAt: Date;
}

export class ActivityDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ACTIVITY_TYPES }) type: string;
  @ApiProperty({ enum: ['order', 'reservation', 'banquet_request', 'banquet_invoice', 'gift_certificate'] }) entityType: string;
  @ApiProperty() entityId: string;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) branchId: string | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) amount: MoneyDto | null;
  @ApiProperty({ description: 'Учитывается в сумме покупок (возврат — отрицательная сумма)' }) countsAsSpent: boolean;
  @ApiProperty() summary: string;
  @ApiProperty({ type: 'object', additionalProperties: true }) meta: Record<string, unknown>;
  @ApiProperty() occurredAt: Date;
}

export class ActivitiesPageDto {
  @ApiProperty({ type: [ActivityDto] }) items: ActivityDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class PeriodTotalsDto {
  @ApiProperty({ type: MoneyDto, description: 'Сумма покупок за период' }) spent: MoneyDto;
  @ApiProperty() ordersPlaced: number;
  @ApiProperty() ordersCompleted: number;
  @ApiProperty() ordersCancelled: number;
  @ApiProperty({ description: 'Возвраты по выполненным заказам' }) ordersRefunded: number;
  @ApiProperty() reservations: number;
  @ApiProperty() noShows: number;
  @ApiProperty() banquetRequests: number;
  @ApiProperty() banquetsHeld: number;
  @ApiProperty() certificatesPurchased: number;
  @ApiProperty() activities: number;
}

export class PeriodDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) from: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true }) to: string | null;
}

export class CustomerDetailDto {
  @ApiProperty({ type: CustomerDto }) customer: CustomerDto;
  @ApiProperty({ type: [ConsentRecordDto], description: 'История согласий, новые сверху' }) consents: ConsentRecordDto[];
  @ApiProperty({ type: PeriodDto }) period: PeriodDto;
  @ApiProperty({ type: PeriodTotalsDto }) totals: PeriodTotalsDto;
  @ApiProperty({ type: ActivitiesPageDto, description: 'История за период, новые сверху' }) activities: ActivitiesPageDto;
}

export class UpdateCustomerDto {
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(120) name?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(254) email?: string | null;
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '1990-05-17' }) @IsOptional() @Matches(DATE_RE) birthday?: string | null;
  @ApiPropertyOptional({ enum: LOCALES }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: Locale;
  @ApiPropertyOptional({ type: [String], description: 'Полный набор тегов (заменяет текущий)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  tags?: string[];
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(2000) allergies?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(2000) preferences?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
}

export class RecordConsentDto {
  @ApiProperty({ enum: CONSENT_KINDS }) @IsIn(CONSENT_KINDS as unknown as string[]) kind: ConsentKind;
  @ApiProperty({ description: 'true — согласие, false — отзыв' }) @IsBoolean() granted: boolean;
  @ApiPropertyOptional({ description: 'Версия текста; по умолчанию — действующая' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  textVersion?: string;
  @ApiProperty({ enum: ['admin', 'phone'], description: 'Получено лично (admin) или по телефону (phone)' })
  @IsIn(['admin', 'phone'])
  source: 'admin' | 'phone';
}

export class AnonymizeCustomerDto {
  @ApiPropertyOptional({ description: 'Основание (например, заявление гостя)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class TagStatDto {
  @ApiProperty() tag: string;
  @ApiProperty() count: number;
}

// ---------------------------------------------------------------- сегменты и выгрузка

export class SegmentDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: CustomerFilterDto }) filter: CustomerFilterDto;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) createdBy: string | null;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) updatedBy: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class SegmentDetailDto extends SegmentDto {
  @ApiProperty({ description: 'Сколько гостей сейчас в сегменте' }) customersCount: number;
}

export class SaveSegmentDto {
  @ApiProperty({ example: 'Постоянные гости GreenLine' }) @IsString() @Length(1, 120) name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiProperty({ type: CustomerFilterDto }) @ValidateNested() @Type(() => CustomerFilterDto) filter: CustomerFilterDto;
}

export class ExportCustomersDto {
  @ApiProperty({ enum: EXPORT_FORMATS }) @IsIn(EXPORT_FORMATS) format: ExportFormat;
  @ApiProperty({
    enum: EXPORT_PURPOSES,
    description: 'marketing — только гости с маркетинговым согласием; service — сервисная выгрузка (цель фиксируется в журнале)',
  })
  @IsIn(EXPORT_PURPOSES)
  purpose: ExportPurpose;
  @ApiPropertyOptional({ description: 'Сегмент (фильтр ниже уточняет его)' }) @IsOptional() @IsUUID() segmentId?: string;
  @ApiPropertyOptional({ type: CustomerFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerFilterDto)
  filter?: CustomerFilterDto;
}

// ---------------------------------------------------------------- тексты согласий

export class ConsentTextDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: CONSENT_KINDS }) kind: ConsentKind;
  @ApiProperty() version: string;
  @ApiProperty({ type: TranslatableDto }) text: TranslatableDto;
  @ApiProperty() publishedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true }) publishedBy: string | null;
  @ApiProperty({ description: 'Действующая версия (показывается на формах)' }) isCurrent: boolean;
}

export class ConsentTextsQueryDto {
  @ApiPropertyOptional({ enum: CONSENT_KINDS })
  @IsOptional()
  @IsIn(CONSENT_KINDS as unknown as string[])
  kind?: ConsentKind;
}

export class PublishConsentTextDto {
  @ApiProperty({ enum: CONSENT_KINDS }) @IsIn(CONSENT_KINDS as unknown as string[]) kind: ConsentKind;
  @ApiProperty({ example: '2026-10-15', description: 'Версия: латиница, цифры, ".", "_", "-"' })
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{1,32}$/)
  version: string;
  @ApiProperty({ type: TranslatableDto, description: 'Текст на kk и ru (обязательно), en — опционально' })
  @ValidateNested()
  @Type(() => TranslatableDto)
  text: TranslatableDto;
}
