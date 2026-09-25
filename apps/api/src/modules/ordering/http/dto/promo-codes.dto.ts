import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MoneyDto, MoneyInputDto, PageQueryDto } from '../../../../shared/infrastructure/http/api-types';
import { PromoCodeView } from '../../application/promo-code.queries';
import { PROMO_KINDS, PromoCodeDefinition, PromoKind } from '../../domain/promo-code';
import { moneyOrNull, queryBoolean } from './common.dto';

export class PromoCodeInputDto {
  @ApiProperty({ example: 'WELCOME10', description: '3-32 символа: латиница, цифры, "-", "_" (регистр не важен)' })
  @IsString()
  @MaxLength(32)
  code: string;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @ApiProperty({ enum: PROMO_KINDS }) @IsIn(PROMO_KINDS) kind: PromoKind;

  @ApiPropertyOptional({ nullable: true, description: 'Для percent: базисные пункты (10% = 1000)', minimum: 1, maximum: 10_000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000)
  percentBp?: number | null;

  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'Для fixed: сумма скидки' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  fixedAmount?: MoneyInputDto | null;

  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'Минимальная сумма блюд' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  minSubtotal?: MoneyInputDto | null;

  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601({ strict: true }) validFrom?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsISO8601({ strict: true }) validTo?: string | null;
  @ApiPropertyOptional({ nullable: true, description: 'Лимит использований всего' }) @IsOptional() @IsInt() @Min(1) totalLimit?: number | null;
  @ApiPropertyOptional({ nullable: true, description: 'Лимит использований на один телефон' })
  @IsOptional()
  @IsInt()
  @Min(1)
  perPhoneLimit?: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'Филиал; null — вся сеть (нужно глобальное право)' })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;

  static toDefinition(dto: PromoCodeInputDto): PromoCodeDefinition {
    return {
      code: dto.code,
      description: dto.description ?? null,
      kind: dto.kind,
      percentBp: dto.percentBp ?? null,
      fixedAmount: dto.fixedAmount ? MoneyInputDto.toMoney(dto.fixedAmount) : null,
      minSubtotal: dto.minSubtotal ? MoneyInputDto.toMoney(dto.minSubtotal) : null,
      validFrom: dto.validFrom ? new Date(dto.validFrom) : null,
      validTo: dto.validTo ? new Date(dto.validTo) : null,
      totalLimit: dto.totalLimit ?? null,
      perPhoneLimit: dto.perPhoneLimit ?? null,
      branchId: dto.branchId ?? null,
      isActive: dto.isActive ?? true,
    };
  }
}

export class PromoListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional({ description: 'Поиск по коду' }) @IsOptional() @IsString() @MaxLength(32) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(queryBoolean) @IsBoolean() active?: boolean;
}

export class PromoUsageDto {
  @ApiProperty({ description: 'Зарезервировано неоплаченными заказами' }) reserved: number;
  @ApiProperty({ description: 'Использовано оплаченными заказами' }) used: number;
  @ApiProperty({ description: 'Освобождено отменой до оплаты' }) released: number;
}

export class PromoCodeDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ enum: PROMO_KINDS }) kind: PromoKind;
  @ApiPropertyOptional({ nullable: true }) percentBp: number | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) fixedAmount: MoneyDto | null;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) minSubtotal: MoneyDto | null;
  @ApiPropertyOptional({ nullable: true }) validFrom: Date | null;
  @ApiPropertyOptional({ nullable: true }) validTo: Date | null;
  @ApiPropertyOptional({ nullable: true }) totalLimit: number | null;
  @ApiPropertyOptional({ nullable: true }) perPhoneLimit: number | null;
  @ApiPropertyOptional({ nullable: true }) branchId: string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ type: PromoUsageDto }) usage: PromoUsageDto;
  @ApiProperty({ description: 'Сотрудник может изменить промокод' }) editable: boolean;

  static from(v: PromoCodeView): PromoCodeDto {
    const p = v.promo;
    return {
      id: p.id,
      code: p.code,
      description: p.description,
      kind: p.kind,
      percentBp: p.percentBp,
      fixedAmount: moneyOrNull(p.fixedAmount),
      minSubtotal: moneyOrNull(p.minSubtotal),
      validFrom: p.validFrom,
      validTo: p.validTo,
      totalLimit: p.totalLimit,
      perPhoneLimit: p.perPhoneLimit,
      branchId: p.branchId,
      isActive: p.isActive,
      usage: { ...v.usage },
      editable: v.editable,
    };
  }
}

export class PromoCodesPageDto {
  @ApiProperty({ type: [PromoCodeDto] }) items: PromoCodeDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() perPage: number;
}
