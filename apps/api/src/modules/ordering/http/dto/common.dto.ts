import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { GeoPointDto, MoneyDto, TranslatableDto } from '../../../../shared/infrastructure/http/api-types';
import { GeoPoint } from '../../../../shared/kernel/geo';
import { Money } from '../../../../shared/kernel/money';
import { Locale, LOCALES, Translatable, translate } from '../../../../shared/kernel/translatable';
import { enumValues } from '../../../../shared/kernel/state-machine';
import { OrderChannel, OrderStatus, OrderType } from '../../public';

export const ORDER_STATUSES = enumValues(OrderStatus);
export const ORDER_TYPES = enumValues(OrderType);
export const ORDER_CHANNELS = enumValues(OrderChannel);
export const CHECKOUT_PAYMENT_METHODS = ['online', 'on_receipt'] as const;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function money(m: Money): MoneyDto {
  return MoneyDto.from(m);
}

export function moneyOrNull(m: Money | null | undefined): MoneyDto | null {
  return m ? MoneyDto.from(m) : null;
}

export function point(p: GeoPoint): GeoPointDto {
  return { lat: p.lat, lng: p.lng };
}

export function translatable(t: Translatable): TranslatableDto {
  return { ...t };
}

export function text(t: Translatable | null | undefined, locale: Locale): string {
  return translate(t, locale);
}

/** Массив из строки запроса: ?status=paid&status=accepted или ?status=paid,accepted. */
export function queryArray({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((v) => (typeof v === 'string' ? v.split(',') : [v])).map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '');
}

/** Булево значение из строки запроса. */
export function queryBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true' || value === '1' || value === true) return true;
  if (value === 'false' || value === '0' || value === false) return false;
  return value;
}

/** Параметр языка витрины (читается декоратором @RequestLocale). */
export class OrderingLocaleQueryDto {
  @ApiPropertyOptional({ enum: LOCALES, default: 'ru' })
  @IsOptional()
  @IsIn(LOCALES as unknown as string[])
  locale?: Locale;
}

export class OrderModifierViewDto {
  @ApiProperty() groupId: string;
  @ApiProperty({ description: 'Название группы модификаторов на языке запроса' }) groupName: string;
  @ApiProperty() optionId: string;
  @ApiProperty({ description: 'Название опции на языке запроса' }) name: string;
  @ApiProperty({ type: MoneyDto }) price: MoneyDto;
}

export class OrderBranchDto {
  @ApiProperty() id: string;
  @ApiProperty() slug: string;
  @ApiProperty({ description: 'Название на языке запроса' }) name: string;
  @ApiProperty({ description: 'Адрес на языке запроса' }) address: string;
  @ApiProperty() phone: string;
  @ApiProperty({ type: GeoPointDto }) location: GeoPointDto;
}
