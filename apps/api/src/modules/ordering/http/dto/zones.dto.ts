import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { GeoPointDto, MoneyDto, MoneyInputDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { DeliveryZoneDefinition, DeliveryZoneState, MAX_ZONE_POINTS } from '../../domain/delivery-zone';
import { money, moneyOrNull, point, translatable } from './common.dto';

export class DeliveryZoneInputDto {
  @ApiProperty({ type: TranslatableDto }) @ValidateNested() @Type(() => TranslatableDto) name: TranslatableDto;

  @ApiProperty({ type: [GeoPointDto], description: 'Кольцо полигона (от 3 точек, без самопересечений)' })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(MAX_ZONE_POINTS)
  @ValidateNested({ each: true })
  @Type(() => GeoPointDto)
  polygon: GeoPointDto[];

  @ApiProperty({ type: MoneyInputDto, description: 'Минимальная сумма заказа (сумма блюд)' })
  @ValidateNested()
  @Type(() => MoneyInputDto)
  minOrderAmount: MoneyInputDto;

  @ApiProperty({ type: MoneyInputDto }) @ValidateNested() @Type(() => MoneyInputDto) deliveryFee: MoneyInputDto;

  @ApiPropertyOptional({ type: MoneyInputDto, nullable: true, description: 'Бесплатная доставка от суммы блюд; null — нет' })
  @IsOptional()
  @ValidateNested()
  @Type(() => MoneyInputDto)
  freeDeliveryFrom?: MoneyInputDto | null;

  @ApiProperty({ minimum: 1, maximum: 600, description: 'Ориентировочное время доставки, минут' })
  @IsInt()
  @Min(1)
  @Max(600)
  etaMinutes: number;

  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() sortOrder?: number;

  static toDefinition(dto: DeliveryZoneInputDto): DeliveryZoneDefinition {
    return {
      name: dto.name,
      polygon: dto.polygon.map((p) => ({ lat: p.lat, lng: p.lng })),
      minOrderAmount: MoneyInputDto.toMoney(dto.minOrderAmount),
      deliveryFee: MoneyInputDto.toMoney(dto.deliveryFee),
      freeDeliveryFrom: dto.freeDeliveryFrom ? MoneyInputDto.toMoney(dto.freeDeliveryFrom) : null,
      etaMinutes: dto.etaMinutes,
      isActive: dto.isActive ?? true,
      sortOrder: dto.sortOrder ?? 0,
    };
  }
}

export class CreateDeliveryZoneDto extends DeliveryZoneInputDto {
  @ApiProperty() @IsUUID() branchId: string;
}

export class ZoneListQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
}

export class DeliveryZoneDto {
  @ApiProperty() id: string;
  @ApiProperty() branchId: string;
  @ApiProperty({ type: TranslatableDto }) name: TranslatableDto;
  @ApiProperty({ type: [GeoPointDto] }) polygon: GeoPointDto[];
  @ApiProperty({ type: MoneyDto }) minOrderAmount: MoneyDto;
  @ApiProperty({ type: MoneyDto }) deliveryFee: MoneyDto;
  @ApiPropertyOptional({ type: MoneyDto, nullable: true }) freeDeliveryFrom: MoneyDto | null;
  @ApiProperty() etaMinutes: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;

  static from(z: DeliveryZoneState): DeliveryZoneDto {
    return {
      id: z.id,
      branchId: z.branchId,
      name: translatable(z.name),
      polygon: z.polygon.map(point),
      minOrderAmount: money(z.minOrderAmount),
      deliveryFee: money(z.deliveryFee),
      freeDeliveryFrom: moneyOrNull(z.freeDeliveryFrom),
      etaMinutes: z.etaMinutes,
      isActive: z.isActive,
      sortOrder: z.sortOrder,
    };
  }
}
