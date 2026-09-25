import { ApiProperty, ApiPropertyOptional, ApiPropertyOptions } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GeoPointDto, TranslatableDto } from '../../../shared/infrastructure/http/api-types';
import { Permission } from '../../../shared/kernel/permissions';
import { OpeningHours } from '../../../shared/kernel/time';
import { STAFF_ROLES } from '../domain/roles';
import { BranchInfo, BranchSettings } from '../public/branch-directory';

const OPENING_HOURS_SCHEMA: ApiPropertyOptions = {
    type: 'object',
    description: 'Часы работы по дням недели (mon..sun), интервалы в локальном времени; close может быть после полуночи',
    additionalProperties: {
      type: 'array',
      items: { type: 'object', properties: { open: { type: 'string', example: '10:00' }, close: { type: 'string', example: '00:00' } }, required: ['open', 'close'] },
    },
    example: { mon: [{ open: '10:00', close: '23:00' }] },
  };

export class LoginDto {
  @ApiProperty({ example: 'owner@aula.kz' })
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  currentPassword: string;

  @ApiProperty({ minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword: string;
}

export class SessionDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty({ description: 'Время жизни access-токена, секунд' })
  expiresIn: number;

  @ApiProperty()
  mustChangePassword: boolean;
}

export class RoleAssignmentDto {
  @ApiProperty({ enum: STAFF_ROLES })
  @IsIn(STAFF_ROLES)
  role: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: 'Филиал для филиальных ролей; null для глобальных' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;
}

export class MeDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  mustChangePassword: boolean;

  @ApiProperty({ type: [RoleAssignmentDto] })
  roles: RoleAssignmentDto[];

  @ApiProperty({ type: [String], description: 'Права во всех филиалах' })
  globalPermissions: Permission[];

  @ApiProperty({ type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } })
  branchPermissions: Record<string, Permission[]>;

  @ApiProperty({ type: [String], description: 'Филиалы, доступные пользователю (для переключателя)' })
  branchIds: string[];
}

export class StaffUserDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) telegramChatId: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() mustChangePassword: boolean;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) lastLoginAt: Date | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty({ type: [RoleAssignmentDto] }) roles: RoleAssignmentDto[];
}

export class StaffUsersPageDto {
  @ApiProperty({ type: [StaffUserDto] }) items: StaffUserDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class CreateUserDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @Length(2, 120) name: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(64) telegramChatId?: string | null;
  @ApiPropertyOptional({ description: 'Если не задан — будет сгенерирован временный пароль' })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password?: string;

  @ApiProperty({ type: [RoleAssignmentDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles: RoleAssignmentDto[];
}

export class CreatedUserDto {
  @ApiProperty({ type: StaffUserDto }) user: StaffUserDto;
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Показывается один раз' }) temporaryPassword: string | null;
}

export class UpdateUserDto {
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 120) name?: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) phone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(64) telegramChatId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SetRolesDto {
  @ApiProperty({ type: [RoleAssignmentDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RoleAssignmentDto)
  roles: RoleAssignmentDto[];
}

export class TemporaryPasswordDto {
  @ApiProperty() temporaryPassword: string;
}

export class RoleDefinitionDto {
  @ApiProperty() role: string;
  @ApiProperty({ enum: ['branch', 'global'] }) scope: string;
  @ApiProperty({ type: 'object', properties: { ru: { type: 'string' }, kk: { type: 'string' } } }) title: { ru: string; kk: string };
  @ApiProperty({ type: [String] }) permissions: string[];
}

export class BranchSettingsDto implements Partial<BranchSettings> {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptsDelivery?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptsPickup?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() acceptsReservations?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) deliveryLeadMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) pickupLeadMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(60) maxScheduleDaysAhead?: number;
  @ApiPropertyOptional({ enum: ['hide', 'mark_unavailable'] }) @IsOptional() @IsIn(['hide', 'mark_unavailable'])
  stopListMode?: 'hide' | 'mark_unavailable';
  @ApiPropertyOptional({ type: [String], enum: ['online', 'on_receipt'] })
  @IsOptional()
  @IsArray()
  @IsIn(['online', 'on_receipt'], { each: true })
  paymentMethods?: Array<'online' | 'on_receipt'>;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(5) @Max(1440) awaitingPaymentTimeoutMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requirePhoneVerificationForOnReceipt?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requirePhoneVerificationForReservations?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() staffNotifyPhone?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() staffTelegramChatId?: string | null;
}

export class BranchInputDto {
  @ApiProperty({ example: 'GL', description: 'Код для номеров документов' }) @IsString() @Matches(/^[A-Za-z0-9]{1,6}$/) code: string;
  @ApiProperty({ example: 'greenline' }) @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) slug: string;
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) address: TranslatableDto;
  @ApiProperty({ type: GeoPointDto }) @ValidateNested() @Type(() => GeoPointDto) location: GeoPointDto;
  @ApiProperty() @IsString() @MaxLength(32) phone: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(32) whatsapp?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsEmail() email?: string | null;
  @ApiPropertyOptional({ default: 'Asia/Almaty' }) @IsOptional() @IsString() timezone?: string;
  @ApiProperty(OPENING_HOURS_SCHEMA)
  @IsObject()
  openingHours: OpeningHours;
  @ApiPropertyOptional({ type: BranchSettingsDto }) @IsOptional() @ValidateNested() @Type(() => BranchSettingsDto) settings?: BranchSettingsDto;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsUUID() legalEntityId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
}

export class BranchDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) address: TranslatableDto;
  @ApiProperty({ type: GeoPointDto }) location: GeoPointDto;
  @ApiProperty() phone: string;
  @ApiPropertyOptional({ type: String, nullable: true }) whatsapp: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) email: string | null;
  @ApiProperty() timezone: string;
  @ApiProperty(OPENING_HOURS_SCHEMA) openingHours: OpeningHours;
  @ApiProperty({ type: BranchSettingsDto }) settings: BranchSettings;
  @ApiPropertyOptional({ type: String, nullable: true }) legalEntityId: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;

  static from(b: BranchInfo): BranchDto {
    return { ...b };
  }
}

/** Публичное представление филиала (без служебных настроек). */
export class PublicBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: TranslatableDto }) address: TranslatableDto;
  @ApiProperty({ type: GeoPointDto }) location: GeoPointDto;
  @ApiProperty() phone: string;
  @ApiPropertyOptional({ type: String, nullable: true }) whatsapp: string | null;
  @ApiProperty() timezone: string;
  @ApiProperty(OPENING_HOURS_SCHEMA) openingHours: OpeningHours;
  @ApiProperty() isOpenNow: boolean;
  @ApiProperty() acceptsDelivery: boolean;
  @ApiProperty() acceptsPickup: boolean;
  @ApiProperty() acceptsReservations: boolean;
  @ApiProperty({ type: [String] }) paymentMethods: string[];
  @ApiProperty() stopListMode: string;
  @ApiProperty({ description: 'Заказ с оплатой при получении требует подтверждения телефона SMS-кодом (POST /public/phone-verifications)' })
  requirePhoneVerificationForOnReceipt: boolean;
  @ApiProperty({ description: 'Бронь без депозита требует подтверждения телефона SMS-кодом' })
  requirePhoneVerificationForReservations: boolean;
}

export class LegalEntityInputDto {
  @ApiProperty({ example: 'ТОО «Express kitchen»' }) @IsString() @Length(2, 300) name: string;
  @ApiProperty({ example: 'Express kitchen' }) @IsString() @Length(1, 120) shortName: string;
  @ApiProperty({ example: '000000000000' }) @IsString() @Matches(/^\d{12}$/) bin: string;
  @ApiProperty() @IsString() @Length(3, 500) legalAddress: string;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() @MaxLength(500) actualAddress: string | null;
  @ApiProperty() @IsString() @Length(2, 200) directorName: string;
  @ApiProperty({ example: 'Директор' }) @IsString() @Length(2, 120) directorPosition: string;
  @ApiProperty({ example: 'Устава' }) @IsString() @Length(2, 200) actingBasis: string;
  @ApiProperty() @IsString() @MaxLength(200) bankName: string;
  @ApiProperty({ example: 'KZ000000000000000000' }) @IsString() @MaxLength(34) iban: string;
  @ApiProperty() @IsString() @MaxLength(16) bik: string;
  @ApiProperty({ example: '17' }) @IsString() @MaxLength(4) kbe: string;
  @ApiProperty() @IsBoolean() vatPayer: boolean;
  @ApiProperty({ description: 'Ставка НДС, базисные пункты (1600 = 16%)' }) @IsInt() @Min(0) @Max(10000) vatRateBp: number;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() vatCertificate: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsString() phone: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) @IsOptional() @IsEmail() email: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class LegalEntityDto extends LegalEntityInputDto {
  @ApiProperty() id: string;
}

export class IntegrationSettingDto {
  @ApiProperty() key: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true }) config: Record<string, unknown>;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Маскированные секреты' })
  secrets: Record<string, string>;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
}

export class SaveIntegrationSettingDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true }) @IsObject() config: Record<string, unknown>;
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string', nullable: true },
    description: 'Новые значения секретов; пустая строка или null — удалить; отсутствие ключа — оставить прежнее',
  })
  @IsOptional()
  @IsObject()
  secrets?: Record<string, string | null>;
}


export class AuditRecordDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurredAt: Date;
  @ApiProperty({ enum: ['staff', 'system', 'guest'] }) actorKind: string;
  @ApiPropertyOptional({ type: String, nullable: true }) actorUserId: string | null;
  @ApiProperty() actorName: string;
  @ApiProperty() action: string;
  @ApiProperty() entityType: string;
  @ApiProperty() entityId: string;
  @ApiPropertyOptional({ type: String, nullable: true }) branchId: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Прежнее значение (JSON)' }) before: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Новое значение (JSON)' }) after: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true }) meta: Record<string, unknown>;
  @ApiPropertyOptional({ type: String, nullable: true }) ip: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) requestId: string | null;
}

export class AuditPageDto {
  @ApiProperty({ type: [AuditRecordDto] }) items: AuditRecordDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class FailedJobDto {
  @ApiProperty() id: string;
  @ApiProperty() kind: string;
  @ApiProperty() topic: string;
  @ApiPropertyOptional({ type: String, nullable: true }) handler: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'Данные задачи (JSON)', nullable: true }) payload: unknown;
  @ApiProperty() error: string;
  @ApiProperty() attempts: number;
  @ApiProperty({ type: String, format: 'date-time' }) failedAt: Date;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) retriedAt: Date | null;
  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true }) resolvedAt: Date | null;
}

export class FailedJobsPageDto {
  @ApiProperty({ type: [FailedJobDto] }) items: FailedJobDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class IntegrationLogDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: String, format: 'date-time' }) occurred_at: Date;
  @ApiProperty() integration: string;
  @ApiProperty({ enum: ['outbound', 'inbound'] }) direction: string;
  @ApiProperty() operation: string;
  @ApiPropertyOptional({ type: String, nullable: true }) correlation_id: string | null;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Запрос (маскирован)' }) request: unknown;
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, nullable: true, description: 'Ответ (маскирован)' }) response: unknown;
  @ApiPropertyOptional({ type: Number, nullable: true }) status_code: number | null;
  @ApiProperty() success: boolean;
  @ApiPropertyOptional({ type: Number, nullable: true }) duration_ms: number | null;
  @ApiPropertyOptional({ type: String, nullable: true }) error: string | null;
}

export class IntegrationLogsPageDto {
  @ApiProperty({ type: [IntegrationLogDto] }) items: IntegrationLogDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}

export class IntegrationFieldDto {
  @ApiProperty() name: string;
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['string', 'url', 'number', 'boolean', 'select', 'json'] }) type: string;
  @ApiPropertyOptional() secret?: boolean;
  @ApiPropertyOptional() required?: boolean;
  @ApiPropertyOptional({ type: [String] }) options?: string[];
  @ApiPropertyOptional() help?: string;
}

export class IntegrationDescriptorDto {
  @ApiProperty() key: string;
  @ApiProperty() title: string;
  @ApiProperty({ enum: ['payments', 'notifications', 'pos', 'delivery', 'accounting', 'esf', 'geocoding', 'analytics', 'other'] }) category: string;
  @ApiProperty({ enum: [1, 2, 3] }) stage: number;
  @ApiProperty() description: string;
  @ApiProperty({ type: [IntegrationFieldDto] }) fields: IntegrationFieldDto[];
}
