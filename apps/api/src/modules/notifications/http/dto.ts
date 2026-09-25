import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { PageDtoOf, PageQueryDto } from '../../../shared/infrastructure/http/api-types';
import { LOCALES } from '../../../shared/kernel/translatable';
import { DELIVERY_STATUSES, MESSAGE_STATUSES } from '../domain/delivery';
import { NOTIFICATION_CHANNELS } from '../domain/delivery-plan';
import { FEED_KINDS, FEED_STREAMS } from '../domain/feed';
import { TEMPLATE_KEYS } from '../domain/templates';

const AUDIENCES = ['guest', 'staff'];
const CHANNELS = [...NOTIFICATION_CHANNELS];
const LOCALE_VALUES = [...LOCALES];

/** Объект «строка -> строка» (параметры шаблона). */
function IsStringRecord(options?: ValidationOptions): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isStringRecord',
      target: object.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be an object with string values`, ...options },
      validator: {
        validate: (value: unknown) =>
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          Object.entries(value as Record<string, unknown>).every(([k, v]) => k.length <= 64 && typeof v === 'string' && v.length <= 2000),
      },
    });
  };
}

// ---------------------------------------------------------------- шаблоны

export class TemplateTitleDto {
  @ApiProperty() ru: string;
  @ApiProperty() kk: string;
}

export class TemplateTextDto {
  @ApiProperty({ enum: CHANNELS }) channel: string;
  @ApiProperty({ enum: LOCALE_VALUES }) locale: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Тема (только email)' }) subject: string | null;
  @ApiProperty({ description: 'Текст с переменными {{param}}' }) body: string;
  @ApiProperty({ description: 'Текст отличается от стартового' }) customized: boolean;
  @ApiProperty({ description: 'Текст сохранён в БД (иначе действует стартовый)' }) stored: boolean;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) updatedAt: Date | null;
  @ApiProperty({ type: [String], description: 'Переменные, использованные в тексте' }) variables: string[];
}

export class NotificationTemplateDto {
  @ApiProperty({ enum: TEMPLATE_KEYS }) key: string;
  @ApiProperty({ enum: AUDIENCES }) audience: string;
  @ApiProperty({ type: TemplateTitleDto }) title: TemplateTitleDto;
  @ApiProperty({ type: [String], description: 'Параметры шаблона (контракт модуля)' }) params: string[];
  @ApiProperty({ type: [String], description: 'Параметры, скрываемые в журнале (коды)' }) sensitiveParams: string[];
  @ApiProperty({ type: [String], description: 'Необязательные параметры (строка с пустым параметром и меткой не выводится)' })
  optionalParams: string[];
  @ApiProperty({ type: [String], enum: CHANNELS }) channels: string[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Пример параметров для предпросмотра' })
  sample: Record<string, string>;
  @ApiProperty({ type: [TemplateTextDto] }) texts: TemplateTextDto[];
}

export class TemplateKeyParamDto {
  @ApiProperty({ enum: TEMPLATE_KEYS }) @IsString() @Matches(/^[a-z_]+\.[a-z_]+$/) key: string;
}

export class TemplateTextParamsDto extends TemplateKeyParamDto {
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel: (typeof CHANNELS)[number];
  @ApiProperty({ enum: LOCALE_VALUES }) @IsIn(LOCALE_VALUES) locale: (typeof LOCALE_VALUES)[number];
}

export class UpdateTemplateTextDto {
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Тема письма (обязательна для email, для других каналов игнорируется)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string | null;

  @ApiProperty({ description: 'Текст с переменными {{param}}' })
  @IsString()
  @Length(1, 20_000)
  body: string;
}

export class ResolvedTemplateTextDto {
  @ApiProperty({ enum: CHANNELS }) channel: string;
  @ApiProperty({ enum: LOCALE_VALUES }) locale: string;
  @ApiPropertyOptional({ nullable: true, type: String }) subject: string | null;
  @ApiProperty() body: string;
  @ApiProperty({ enum: ['db', 'default'] }) source: string;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) updatedAt: Date | null;
}

export class PreviewTemplateDto {
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel: (typeof CHANNELS)[number];
  @ApiProperty({ enum: LOCALE_VALUES }) @IsIn(LOCALE_VALUES) locale: (typeof LOCALE_VALUES)[number];
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Черновик темы (email)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Черновик текста; не задан — сохранённый текст' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  body?: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'string' }, description: 'Значения параметров; по умолчанию — пример' })
  @IsOptional()
  @IsObject()
  @IsStringRecord()
  params?: Record<string, string>;
}

export class SmsInfoDto {
  @ApiProperty({ enum: ['gsm7', 'ucs2'] }) encoding: string;
  @ApiProperty({ description: 'Длина в символах кодировки' }) length: number;
  @ApiProperty({ description: 'Сколько SMS (частей) займёт текст' }) segments: number;
}

export class TemplatePreviewDto {
  @ApiProperty({ enum: CHANNELS, description: 'Канал, чей текст использован' }) channel: string;
  @ApiProperty({ enum: LOCALE_VALUES }) locale: string;
  @ApiPropertyOptional({ nullable: true, type: String }) subject: string | null;
  @ApiProperty() text: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'HTML-версия письма (email)' }) html: string | null;
  @ApiProperty({ type: [String], description: 'Переменные, которых нет среди параметров шаблона' }) unknownVariables: string[];
  @ApiProperty() length: number;
  @ApiPropertyOptional({ nullable: true, type: SmsInfoDto }) sms: SmsInfoDto | null;
}

// ---------------------------------------------------------------- журнал доставки

export class DeliveryLogQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: DELIVERY_STATUSES }) @IsOptional() @IsIn(DELIVERY_STATUSES) status?: (typeof DELIVERY_STATUSES)[number];
  @ApiPropertyOptional({ enum: CHANNELS }) @IsOptional() @IsIn(CHANNELS) channel?: (typeof CHANNELS)[number];
  @ApiPropertyOptional({ enum: TEMPLATE_KEYS }) @IsOptional() @IsIn(TEMPLATE_KEYS) template?: string;
  @ApiPropertyOptional({ enum: AUDIENCES }) @IsOptional() @IsIn(AUDIENCES) audience?: 'guest' | 'staff';
  @ApiPropertyOptional({ description: 'С момента (ISO 8601)', format: 'date-time' }) @IsOptional() @IsISO8601() from?: string;
  @ApiPropertyOptional({ description: 'До момента (ISO 8601, не включая)', format: 'date-time' }) @IsOptional() @IsISO8601() to?: string;
  @ApiPropertyOptional({ description: 'Адресат: телефон, email или id чата (точное совпадение; в ответе — маска)' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipient?: string;
  @ApiPropertyOptional({ description: 'Тип связанного объекта: order, reservation, banquet_request, gift_certificate...' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  relatedType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) relatedId?: string;
}

export class RelatedEntityDto {
  @ApiProperty() type: string;
  @ApiProperty() id: string;
}

export class DeliveryLogItemDto {
  @ApiProperty() id: string;
  @ApiProperty() messageId: string;
  @ApiProperty({ enum: TEMPLATE_KEYS }) template: string;
  @ApiProperty({ enum: AUDIENCES }) audience: string;
  @ApiProperty({ enum: LOCALE_VALUES }) locale: string;
  @ApiProperty({ enum: CHANNELS, description: 'Текущий (итоговый) канал доставки' }) channel: string;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Провайдер, отправивший сообщение (log — журнал вне продакшена)' })
  provider: string | null;
  @ApiProperty({ description: 'Адресат (маска)', example: '+7 701 *** ** 67' }) recipient: string;
  @ApiPropertyOptional({ nullable: true, type: String }) recipientName: string | null;
  @ApiProperty({ enum: DELIVERY_STATUSES }) status: string;
  @ApiProperty({ enum: MESSAGE_STATUSES }) messageStatus: string;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional({ nullable: true, type: String }) lastError: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) sentAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) deliveredAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' }) readAt: Date | null;
  @ApiPropertyOptional({ nullable: true, type: RelatedEntityDto }) related: RelatedEntityDto | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Исходное сообщение (для повторной отправки)' })
  resentFromId: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) branchId: string | null;
}

export class DeliveryLogPageDto extends PageDtoOf(DeliveryLogItemDto) {}

export class DeliveryChainStepDto {
  @ApiProperty({ enum: CHANNELS }) channel: string;
  @ApiProperty({ description: 'Адресат (маска)' }) recipient: string;
}

export class DeliveryAttemptDto {
  @ApiProperty() attemptNo: number;
  @ApiProperty({ enum: CHANNELS }) channel: string;
  @ApiPropertyOptional({ nullable: true, type: String }) provider: string | null;
  @ApiProperty({ description: 'Адресат (маска)' }) recipient: string;
  @ApiProperty({ enum: ['sent', 'failed', 'skipped'] }) status: string;
  @ApiProperty({ description: 'Временная ошибка (будет повтор)' }) retryable: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) errorCode: string | null;
  @ApiPropertyOptional({ nullable: true, type: String }) error: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Идентификатор сообщения у провайдера' }) externalId: string | null;
  @ApiPropertyOptional({ nullable: true, type: Number }) durationMs: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt: Date;
}

export class DeliveryDetailDto extends DeliveryLogItemDto {
  @ApiProperty({ type: [DeliveryChainStepDto], description: 'Цепочка каналов с резервом' }) chain: DeliveryChainStepDto[];
  @ApiProperty({ description: 'Текущий шаг цепочки' }) stepIndex: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Параметры (коды скрыты)' })
  params: Record<string, string>;
  @ApiPropertyOptional({ nullable: true, type: String }) renderedSubject: string | null;
  @ApiPropertyOptional({ nullable: true, type: String, description: 'Отправленный текст (коды скрыты)' }) renderedText: string | null;
  @ApiProperty({ type: [DeliveryAttemptDto] }) attemptLog: DeliveryAttemptDto[];
}

export class DeliveryIdParamDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() id: string;
}

export class QueuedDeliveryDto {
  @ApiProperty() messageId: string;
  @ApiProperty() deliveryId: string;
}

export class TestSendDto {
  @ApiProperty({ enum: CHANNELS }) @IsIn(CHANNELS) channel: (typeof CHANNELS)[number];
  @ApiProperty({ description: 'Телефон (+7...), email или id чата Telegram', example: '+77011234567' })
  @IsString()
  @Length(1, 120)
  to: string;
  @ApiPropertyOptional({ enum: TEMPLATE_KEYS, description: 'Шаблон (по умолчанию staff.system_alert), параметры — пример' })
  @IsOptional()
  @IsIn(TEMPLATE_KEYS)
  template?: string;
  @ApiPropertyOptional({ enum: LOCALE_VALUES, default: 'ru' }) @IsOptional() @IsIn(LOCALE_VALUES) locale?: (typeof LOCALE_VALUES)[number];
}

export class ChannelStatusDto {
  @ApiProperty({ enum: CHANNELS }) channel: string;
  @ApiProperty() configured: boolean;
  @ApiProperty({ type: [String], description: 'Настроенные провайдеры канала' }) providers: string[];
  @ApiProperty({ description: 'Вне продакшена ненастроенный канал пишет сообщения в журнал приложения' }) logFallback: boolean;
}

// ---------------------------------------------------------------- лента админки

export class FeedTicketDto {
  @ApiProperty({ description: 'Билет для GET /admin/feed/stream?ticket=... (EventSource не передаёт заголовок Authorization)' })
  ticket: string;
  @ApiProperty({ description: 'Срок действия билета, секунд. После обрыва и истечения — получить новый билет' }) expiresIn: number;
}

export class FeedStreamQueryDto {
  @ApiProperty({ description: 'Билет из POST /admin/feed/ticket' }) @IsString() @Length(10, 4096) ticket: string;
}

export class FeedRecentQueryDto {
  @ApiPropertyOptional({ description: 'После момента (ISO 8601) или после события с этим id (последний полученный)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  since?: string;
  @ApiPropertyOptional({ default: 100, minimum: 1, maximum: 500 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

export class FeedItemDto {
  @ApiProperty({ description: 'Идентификатор события (для Last-Event-ID и since)' }) id: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt: string;
  @ApiPropertyOptional({ nullable: true, type: String }) branchId: string | null;
  @ApiProperty({ enum: FEED_STREAMS, description: 'Очередь: orders, reservations, banquets, system' }) stream: string;
  @ApiProperty({ enum: FEED_KINDS, description: 'created — новый элемент очереди, updated — изменение' }) kind: string;
  @ApiProperty() entityId: string;
  @ApiProperty() title: string;
  @ApiProperty({ description: 'Проиграть звук' }) sound: boolean;
}

// ---------------------------------------------------------------- вебхуки

export class WebhookAckDto {
  @ApiProperty() received: boolean;
  @ApiProperty({ description: 'Применено статусов' }) applied: number;
  @ApiProperty({ description: 'Пропущено (повтор, неизвестное сообщение)' }) ignored: number;
}
