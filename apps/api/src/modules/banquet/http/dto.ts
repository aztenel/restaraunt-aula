import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
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
import { MoneyInputDto, PageQueryDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { Money } from '../../../shared/kernel/money';
import { Locale, LOCALES } from '../../../shared/kernel/translatable';
import { ALL_BANQUET_STATUSES } from '../domain/banquet-status';
import { INVOICE_PURPOSES, InvoiceStatus, PAYER_TYPES, PayerType } from '../domain/invoice';
import { QuoteDiscount } from '../domain/quote';
import { BANQUET_EVENT_TYPES, QUOTE_LINE_KINDS, QuoteLineKind } from '../domain/texts';
import { MANUAL_ACTIVITY_KINDS, ManualActivityKind } from '../infrastructure/activity.repository';
import { BanquetStatus } from '../public';

/** Входные DTO модуля Banquet (class-validator + OpenAPI). Суммы — тиыны { amount, currency }. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const INVOICE_STATUSES: InvoiceStatus[] = ['issued', 'partially_paid', 'paid', 'cancelled'];

/** 'true'/'false' из строки запроса -> boolean (остальное отклонит @IsBoolean). */
const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export function moneyOrNull(dto: MoneyInputDto | null | undefined): Money | null {
  return dto ? MoneyInputDto.toMoney(dto) : null;
}

// ---------------------------------------------------------------- заявка

export class ContactInputDto {
  @ApiProperty({ example: 'Айгерим' }) @IsString() @Length(1, 120) name: string;
  @ApiProperty({ example: '+7 701 123 45 67', description: 'Нормализуется в +7XXXXXXXXXX' }) @IsString() @Length(5, 32) phone: string;
  @ApiPropertyOptional({ example: 'aigerim@mail.kz' }) @IsOptional() @IsEmail() @MaxLength(200) email?: string;
}

export class ConsentInputDto {
  @ApiProperty({ description: 'Согласие на обработку персональных данных (на витрине обязательно true)' }) @IsBoolean() personalData: boolean;
  @ApiPropertyOptional({ description: 'Согласие на рекламные рассылки' }) @IsOptional() @IsBoolean() marketing?: boolean;
}

export class PublicCreateRequestDto {
  @ApiProperty({ example: '2026-11-14', description: 'Дата мероприятия (локальная)' }) @Matches(DATE_RE) eventDate: string;
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(TIME_RE) eventTime?: string;
  @ApiProperty({ enum: BANQUET_EVENT_TYPES }) @IsIn(BANQUET_EVENT_TYPES as unknown as string[]) eventType: string;
  @ApiProperty({ minimum: 1, maximum: 5000, example: 80 }) @IsInt() @Min(1) @Max(5000) guests: number;
  @ApiPropertyOptional({ description: 'Филиал (обязателен, если не выезд)' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Выездное обслуживание (кейтеринг): нужен адрес' }) @IsOptional() @IsBoolean() offsite?: boolean;
  @ApiPropertyOptional({ description: 'Адрес выезда' }) @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Бюджет' }) @IsOptional() @ValidateNested() @Type(() => MoneyInputDto) budget?: MoneyInputDto;
  @ApiProperty({ type: ContactInputDto }) @ValidateNested() @Type(() => ContactInputDto) contact: ContactInputDto;
  @ApiPropertyOptional({ description: 'Пожелания' }) @IsOptional() @IsString() @MaxLength(4000) wishes?: string;
  @ApiProperty({ type: ConsentInputDto }) @ValidateNested() @Type(() => ConsentInputDto) consent: ConsentInputDto;
  @ApiProperty({ enum: LOCALES }) @IsIn(LOCALES as unknown as string[]) locale: Locale;
}

export class AdminCreateRequestDto {
  @ApiProperty({ example: '2026-11-14' }) @Matches(DATE_RE) eventDate: string;
  @ApiPropertyOptional({ example: '18:00' }) @IsOptional() @Matches(TIME_RE) eventTime?: string;
  @ApiProperty({ enum: BANQUET_EVENT_TYPES }) @IsIn(BANQUET_EVENT_TYPES as unknown as string[]) eventType: string;
  @ApiProperty({ minimum: 1, maximum: 5000 }) @IsInt() @Min(1) @Max(5000) guests: number;
  @ApiPropertyOptional({ description: 'Филиал проведения или филиал-исполнитель выезда' }) @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offsite?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) address?: string;
  @ApiPropertyOptional({ type: MoneyInputDto }) @IsOptional() @ValidateNested() @Type(() => MoneyInputDto) budget?: MoneyInputDto;
  @ApiProperty({ type: ContactInputDto }) @ValidateNested() @Type(() => ContactInputDto) contact: ContactInputDto;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) wishes?: string;
  @ApiPropertyOptional({ type: ConsentInputDto, description: 'Согласие гостя, полученное менеджером (по телефону / лично)' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConsentInputDto)
  consent?: ConsentInputDto;
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: Locale;
  @ApiPropertyOptional({ description: 'Ответственный менеджер (иначе — автоназначение)' }) @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional({ description: 'Компания-заказчик' }) @IsOptional() @IsUUID() companyId?: string;
}

export class UpdateRequestDto {
  @ApiPropertyOptional({ example: '2026-11-14' }) @IsOptional() @Matches(DATE_RE) eventDate?: string;
  @ApiPropertyOptional({ example: '18:00', nullable: true }) @IsOptional() @Matches(TIME_RE) eventTime?: string | null;
  @ApiPropertyOptional({ enum: BANQUET_EVENT_TYPES }) @IsOptional() @IsIn(BANQUET_EVENT_TYPES as unknown as string[]) eventType?: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 5000 }) @IsOptional() @IsInt() @Min(1) @Max(5000) guests?: number;
  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true }) @IsOptional() @ValidateNested() @Type(() => MoneyInputDto) budget?: MoneyInputDto | null;
  @ApiPropertyOptional({ nullable: true, description: 'Филиал проведения / филиал-исполнитель выезда' }) @IsOptional() @IsUUID() branchId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offsite?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(4000) wishes?: string | null;
  @ApiPropertyOptional({ type: ContactInputDto }) @IsOptional() @ValidateNested() @Type(() => ContactInputDto) contact?: ContactInputDto;
  @ApiPropertyOptional({ nullable: true, description: 'Компания-заказчик (null — физлицо)' }) @IsOptional() @IsUUID() companyId?: string | null;
}

export class TransitionDto {
  @ApiProperty({ enum: ALL_BANQUET_STATUSES }) @IsIn(ALL_BANQUET_STATUSES as unknown as string[]) to: BanquetStatus;
  @ApiPropertyOptional({ description: 'Причина (для отмены обязательна)' }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class AssignDto {
  @ApiProperty() @IsUUID() managerId: string;
}

export class ActivityInputDto {
  @ApiProperty({ enum: MANUAL_ACTIVITY_KINDS, description: 'call / contact / meeting — ответ гостю (SLA)' })
  @IsIn(MANUAL_ACTIVITY_KINDS as unknown as string[])
  kind: ManualActivityKind;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) text?: string;
}

export class SetVenueDto {
  @ApiProperty() @IsUUID() venueId: string;
  @ApiPropertyOptional({ example: '2026-11-14', description: 'Локальная дата начала (по умолчанию — дата мероприятия)' })
  @IsOptional()
  @Matches(DATE_RE)
  date?: string;
  @ApiProperty({ example: '17:00' }) @Matches(TIME_RE) startTime: string;
  @ApiProperty({ example: '23:30', description: 'Раньше начала — следующий день' }) @Matches(TIME_RE) endTime: string;
}

export class PrepaymentInputDto {
  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'null — 50% итога согласованной сметы' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  amount?: MoneyInputDto | null;
}

// ---------------------------------------------------------------- смета

export class DiscountInputDto {
  @ApiProperty({ enum: ['percent', 'amount'] }) @IsIn(['percent', 'amount']) type: 'percent' | 'amount';
  @ApiPropertyOptional({ description: 'Процент в базисных пунктах (1000 = 10%)', minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  bp?: number;
  @ApiPropertyOptional({ type: MoneyInputDto }) @IsOptional() @ValidateNested() @Type(() => MoneyInputDto) amount?: MoneyInputDto;
}

export function toDiscount(dto: DiscountInputDto | null | undefined): QuoteDiscount {
  if (!dto) return null;
  if (dto.type === 'percent') return { type: 'percent', bp: dto.bp ?? 0 };
  return { type: 'amount', amount: dto.amount ? MoneyInputDto.toMoney(dto.amount) : Money.zero() };
}

export class QuoteLineInputDto {
  @ApiProperty({ enum: QUOTE_LINE_KINDS }) @IsIn(QUOTE_LINE_KINDS as unknown as string[]) kind: QuoteLineKind;
  @ApiPropertyOptional({ description: 'Блюдо (для kind=menu): название и цена филиала — снимок на момент добавления' })
  @IsOptional()
  @IsUUID()
  dishId?: string;
  @ApiPropertyOptional({ type: TranslatableDto, description: 'Название произвольной позиции' })
  @IsOptional()
  @ValidateNested()
  @Type(() => TranslatableDto)
  title?: TranslatableDto;
  @ApiPropertyOptional({ example: 'порц.' }) @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Цена за единицу произвольной позиции' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  unitPrice?: MoneyInputDto;
  @ApiProperty({ minimum: 1, maximum: 100000 }) @IsInt() @Min(1) @Max(100_000) quantity: number;
  @ApiPropertyOptional({ type: DiscountInputDto }) @IsOptional() @ValidateNested() @Type(() => DiscountInputDto) discount?: DiscountInputDto;
}

export class SaveQuoteDto {
  @ApiProperty({ type: [QuoteLineInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => QuoteLineInputDto)
  lines: QuoteLineInputDto[];
  @ApiPropertyOptional({ type: DiscountInputDto, description: 'Общая скидка' })
  @IsOptional()
  @ValidateNested()
  @Type(() => DiscountInputDto)
  discount?: DiscountInputDto;
  @ApiPropertyOptional({ description: 'Процент за обслуживание, базисные пункты (1000 = 10%)', minimum: 0, maximum: 5000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  serviceChargeBp?: number;
  @ApiPropertyOptional({ description: 'Гостей для расчёта «на гостя» (по умолчанию — из заявки)' }) @IsOptional() @IsInt() @Min(1) @Max(5000) guests?: number;
  @ApiPropertyOptional({ example: '2026-10-15' }) @IsOptional() @Matches(DATE_RE) validUntil?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) notes?: string;
  @ApiPropertyOptional({ description: 'Обновить цены позиций меню по текущему меню филиала' }) @IsOptional() @IsBoolean() refreshMenuPrices?: boolean;
}

export class AcceptQuoteDto {
  @ApiProperty({ description: 'Версия сметы, которую видел клиент' }) @IsInt() @Min(1) version: number;
}

export class MenuSearchQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ example: 'плов' }) @IsString() @Length(1, 100) q: string;
  @ApiPropertyOptional({ default: 20, maximum: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

// ---------------------------------------------------------------- счета

export class IssueInvoiceDto {
  @ApiProperty({ enum: PAYER_TYPES }) @IsIn(PAYER_TYPES as unknown as string[]) payerType: PayerType;
  @ApiPropertyOptional({ description: 'Компания-заказчик (по умолчанию — компания заявки)' }) @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'По умолчанию — остаток предоплаты или остаток до итога сметы' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  amount?: MoneyInputDto;
  @ApiPropertyOptional({ example: '2026-10-05' }) @IsOptional() @Matches(DATE_RE) dueDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}

export class BankTransferDto {
  @ApiProperty({ type: MoneyInputDto }) @ValidateNested() @Type(() => MoneyInputDto) amount: MoneyInputDto;
  @ApiProperty({ example: '2026-10-02T10:00:00+05:00', description: 'Дата и время поступления' }) @IsISO8601() paidAt: string;
  @ApiProperty({ example: '1234', description: 'Номер платёжного поручения' }) @IsString() @Length(1, 60) documentNumber: string;
}

export class CancelInvoiceDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class RefundInputDto {
  @ApiProperty({ description: 'Платёж по счёту заявки' }) @IsUUID() paymentId: string;
  @ApiPropertyOptional({ type: MoneyInputDto, description: 'Частичный возврат; без суммы — полный' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  amount?: MoneyInputDto;
  @ApiProperty() @IsString() @Length(1, 500) reason: string;
  @ApiProperty({ description: 'Ключ идемпотентности (генерирует админка на одну попытку)' }) @IsString() @Length(8, 100) idempotencyKey: string;
}

export class InvoicesQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: `Статусы через запятую: ${INVOICE_STATUSES.join(', ')}` }) @IsOptional() @IsString() @MaxLength(100) status?: string;
  @ApiPropertyOptional({ type: Boolean, description: 'Только просроченные' }) @IsOptional() @Transform(toBoolean) @IsBoolean() overdue?: boolean;
}

export function parseInvoiceStatuses(value: string | undefined): InvoiceStatus[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is InvoiceStatus => (INVOICE_STATUSES as string[]).includes(s));
}

export const INVOICE_PURPOSE_VALUES = INVOICE_PURPOSES;

// ---------------------------------------------------------------- списки, календарь, SLA

export class RequestsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: `Статусы через запятую: ${ALL_BANQUET_STATUSES.join(', ')}` }) @IsOptional() @IsString() @MaxLength(200) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ example: '2026-10-01', description: 'Дата мероприятия с' }) @IsOptional() @Matches(DATE_RE) dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-12-31', description: 'Дата мероприятия по' }) @IsOptional() @Matches(DATE_RE) dateTo?: string;
  @ApiPropertyOptional({ description: 'Номер, имя или телефон' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ type: Boolean }) @IsOptional() @Transform(toBoolean) @IsBoolean() offsite?: boolean;
  @ApiPropertyOptional({ type: Boolean, description: 'Нарушен SLA первого ответа' }) @IsOptional() @Transform(toBoolean) @IsBoolean() slaBreached?: boolean;
}

export class PipelineQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() managerId?: string;
  @ApiPropertyOptional({ example: '2026-10-01' }) @IsOptional() @Matches(DATE_RE) dateFrom?: string;
  @ApiPropertyOptional({ example: '2026-12-31' }) @IsOptional() @Matches(DATE_RE) dateTo?: string;
}

export function parseStatuses(value: string | undefined): BanquetStatus[] | undefined {
  if (!value) return undefined;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is BanquetStatus => (ALL_BANQUET_STATUSES as string[]).includes(s));
}

export class CalendarQueryDto {
  @ApiProperty() @IsUUID() branchId: string;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE_RE) from: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE_RE) to: string;
}

export class SlaQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE_RE) from: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE_RE) to: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

// ---------------------------------------------------------------- компании, шаблоны, документы

export class CompanyInputDto {
  @ApiProperty({ example: 'ТОО «Ромашка»' }) @IsString() @Length(1, 300) name: string;
  @ApiProperty({ example: '940140001234', description: 'БИН, 12 цифр' }) @IsString() @Length(12, 16) bin: string;
  @ApiProperty() @IsString() @Length(1, 500) legalAddress: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) bankName?: string;
  @ApiPropertyOptional({ example: 'KZ123456789012345678', description: 'ИИК (IBAN)' }) @IsOptional() @IsString() @MaxLength(34) iban?: string;
  @ApiPropertyOptional({ example: 'CASPKZKA' }) @IsOptional() @IsString() @MaxLength(11) bik?: string;
  @ApiPropertyOptional({ example: '17' }) @IsOptional() @IsString() @MaxLength(2) kbe?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) directorName?: string;
  @ApiPropertyOptional({ example: 'Директор' }) @IsOptional() @IsString() @MaxLength(200) directorPosition?: string;
  @ApiPropertyOptional({ example: 'Устава' }) @IsOptional() @IsString() @MaxLength(200) actingBasis?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(200) contactEmail?: string;
}

export class CompaniesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Название или БИН' }) @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class TemplateInputDto {
  @ApiProperty({ example: 'banquet-standard' }) @IsString() @Matches(/^[a-z0-9_-]{2,60}$/) code: string;
  @ApiProperty({ example: 'Договор на банкетное обслуживание' }) @IsString() @Length(1, 200) name: string;
  @ApiProperty({ description: 'Текст с подстановками {{seller.name}}, {{client.bin}}, {{event.date}}, {{quote.total}} …' })
  @IsString()
  @Length(20, 100_000)
  body: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class GenerateContractDto {
  @ApiPropertyOptional({ description: 'Шаблон (по умолчанию — шаблон по умолчанию)' }) @IsOptional() @IsUUID() templateId?: string;
}
