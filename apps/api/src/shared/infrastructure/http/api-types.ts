import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CURRENCIES, Currency, Money } from '../../kernel/money';
import { Translatable } from '../../kernel/translatable';

/**
 * Общие DTO для OpenAPI. Деньги в API — всегда { amount (тиыны, целое), currency }.
 * Фронтенд только форматирует, но не считает.
 */
export class MoneyDto {
  @ApiProperty({ description: 'Сумма в минимальных единицах (тиыны), целое число', example: 250000 })
  @IsInt()
  amount: number;

  @ApiProperty({ enum: CURRENCIES, example: 'KZT' })
  @IsIn(CURRENCIES as unknown as string[])
  currency: Currency;

  static from(money: Money): MoneyDto {
    return { amount: money.amount, currency: money.currency };
  }
}

/** Неотрицательная сумма во входных данных. */
export class MoneyInputDto {
  @ApiProperty({ description: 'Сумма в тиынах, целое неотрицательное', example: 250000 })
  @IsInt()
  @Min(0)
  amount: number;

  @ApiPropertyOptional({ enum: CURRENCIES, default: 'KZT' })
  @IsOptional()
  @IsIn(CURRENCIES as unknown as string[])
  currency?: Currency;

  static toMoney(dto: MoneyInputDto): Money {
    return Money.of(dto.amount, dto.currency ?? 'KZT');
  }
}

export class TranslatableDto implements Translatable {
  @ApiPropertyOptional({ description: 'Қазақша' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  kk?: string;

  @ApiPropertyOptional({ description: 'Русский' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  ru?: string;

  @ApiPropertyOptional({ description: 'English (опционально)' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  en?: string;
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  perPage?: number;
}

export class GeoPointDto {
  @ApiProperty({ example: 51.1282 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @ApiProperty({ example: 71.4304 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}

export class ErrorResponseDto {
  @ApiProperty({ example: { code: 'order.invalid_transition', message: 'Transition not allowed', details: {} } })
  error: { code: string; message: string; details?: Record<string, unknown> };

  @ApiProperty({ nullable: true })
  requestId: string | null;
}

/** Помощник для описания страниц в OpenAPI: class OrdersPageDto extends PageDtoOf(OrderDto) {}. */
export function PageDtoOf<T>(itemType: new () => T) {
  class PageDto {
    @ApiProperty({ type: [itemType] })
    @ValidateNested({ each: true })
    items: T[];

    @ApiProperty()
    total: number;

    @ApiProperty()
    page: number;

    @ApiProperty()
    perPage: number;
  }
  return PageDto;
}
