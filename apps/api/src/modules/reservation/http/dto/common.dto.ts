import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { RULE_LIMITS } from '../../domain/venue-rules';
import { VENUE_SHAPES, VenueShape } from '../../domain/venue';

/** Общие DTO модуля: изображения, правила брони места, позиция на плане зала. */

/** Имена схем изображений брони отличаются от ImageDto/ImageVariantDto каталога (здесь есть thumbnailUrl), иначе схемы в OpenAPI сливаются. */
@ApiSchema({ name: 'VenueImageVariantDto' })
export class ImageVariantDto {
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty() url: string;
}

@ApiSchema({ name: 'VenueImageDto' })
export class ImageDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Основной вариант (карточка)' }) url: string;
  @ApiProperty({ description: 'Уменьшенный вариант (списки, карта зала)' }) thumbnailUrl: string;
  @ApiProperty() width: number;
  @ApiProperty() height: number;
  @ApiProperty({ type: [ImageVariantDto], description: 'Все варианты (srcset)' }) variants: ImageVariantDto[];
}

const [durMin, durMax] = RULE_LIMITS.durationMinutes;
const [holdMin, holdMax] = RULE_LIMITS.holdMinutes;
const [dlMin, dlMax] = RULE_LIMITS.cancellationDeadlineHours;
const [clMin, clMax] = RULE_LIMITS.cleanupMinutes;
const [stMin, stMax] = RULE_LIMITS.slotStepMinutes;

/** Правила брони (полный набор): правила типа места или действующие правила места. */
export class VenueRulesDto {
  @ApiProperty({ minimum: durMin, maximum: durMax, example: 120, description: 'Длительность брони по умолчанию, минут' })
  @IsInt()
  @Min(durMin)
  @Max(durMax)
  durationMinutes: number;

  @ApiProperty({ minimum: holdMin, maximum: holdMax, example: 30, description: 'Сколько держится неподтверждённая / неоплаченная бронь, минут' })
  @IsInt()
  @Min(holdMin)
  @Max(holdMax)
  holdMinutes: number;

  @ApiProperty({ minimum: dlMin, maximum: dlMax, example: 24, description: 'За сколько часов до начала можно отменить с возвратом депозита' })
  @IsInt()
  @Min(dlMin)
  @Max(dlMax)
  cancellationDeadlineHours: number;

  @ApiProperty({ description: 'Бронь с витрины ждёт подтверждения персоналом (pending)' })
  @IsBoolean()
  requiresManualConfirmation: boolean;

  @ApiProperty({ minimum: clMin, maximum: clMax, example: 15, description: 'Буфер на уборку после брони, минут' })
  @IsInt()
  @Min(clMin)
  @Max(clMax)
  cleanupMinutes: number;

  @ApiProperty({ minimum: stMin, maximum: stMax, example: 30, description: 'Шаг сетки времени (альтернативы), минут' })
  @IsInt()
  @Min(stMin)
  @Max(stMax)
  slotStepMinutes: number;

  @ApiProperty({ description: 'Можно бронировать на витрине (иначе — только через оператора)' })
  @IsBoolean()
  bookableOnline: boolean;
}

/** Частичное изменение правил типа. */
export class VenueRulesPatchDto {
  @ApiPropertyOptional({ minimum: durMin, maximum: durMax }) @IsOptional() @IsInt() @Min(durMin) @Max(durMax) durationMinutes?: number;
  @ApiPropertyOptional({ minimum: holdMin, maximum: holdMax }) @IsOptional() @IsInt() @Min(holdMin) @Max(holdMax) holdMinutes?: number;
  @ApiPropertyOptional({ minimum: dlMin, maximum: dlMax }) @IsOptional() @IsInt() @Min(dlMin) @Max(dlMax) cancellationDeadlineHours?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresManualConfirmation?: boolean;
  @ApiPropertyOptional({ minimum: clMin, maximum: clMax }) @IsOptional() @IsInt() @Min(clMin) @Max(clMax) cleanupMinutes?: number;
  @ApiPropertyOptional({ minimum: stMin, maximum: stMax }) @IsOptional() @IsInt() @Min(stMin) @Max(stMax) slotStepMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bookableOnline?: boolean;
}

/** Переопределения правил типа для места: значение — своё правило, null / отсутствие — «как у типа». */
export class VenueRuleOverridesDto {
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: durMin, maximum: durMax }) @IsOptional() @IsInt() @Min(durMin) @Max(durMax) durationMinutes?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: holdMin, maximum: holdMax }) @IsOptional() @IsInt() @Min(holdMin) @Max(holdMax) holdMinutes?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: dlMin, maximum: dlMax })
  @IsOptional()
  @IsInt()
  @Min(dlMin)
  @Max(dlMax)
  cancellationDeadlineHours?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) @IsOptional() @IsBoolean() requiresManualConfirmation?: boolean | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: clMin, maximum: clMax }) @IsOptional() @IsInt() @Min(clMin) @Max(clMax) cleanupMinutes?: number | null;
  @ApiPropertyOptional({ type: Number, nullable: true, minimum: stMin, maximum: stMax }) @IsOptional() @IsInt() @Min(stMin) @Max(stMax) slotStepMinutes?: number | null;
  @ApiPropertyOptional({ type: Boolean, nullable: true }) @IsOptional() @IsBoolean() bookableOnline?: boolean | null;
}

/**
 * Система координат плана зала: целые условные единицы плана (не пиксели; план planWidth × planHeight
 * масштабируется в область показа с сохранением пропорций), начало (0,0) — левый верхний угол плана,
 * ось x — вправо, ось y — вниз.
 */
export const PLAN_WIDTH_DESCRIPTION =
  'Ширина плана зала, условные единицы (целые, не пиксели). Координаты мест: начало (0,0) — левый верхний угол плана, x — вправо, y — вниз';
export const PLAN_HEIGHT_DESCRIPTION = 'Высота плана зала, условные единицы (ось y направлена вниз)';

const POSITION_X = 'Левая граница места до поворота, единицы плана (от левого края плана)';
const POSITION_Y = 'Верхняя граница места до поворота, единицы плана (от верхнего края плана, y — вниз)';
const POSITION_W = 'Ширина места до поворота, единицы плана';
const POSITION_H = 'Высота места до поворота, единицы плана';
const POSITION_SHAPE = 'rect — прямоугольник w × h; circle — эллипс (круг при w = h), вписанный в прямоугольник w × h';
const POSITION_ROTATION =
  'Поворот в градусах (целые 0–359) по часовой стрелке на экране (ось y вниз) вокруг центра места (x + w/2, y + h/2); ' +
  'SVG: rotate(rotation, x + w/2, y + h/2). В границы плана должен помещаться прямоугольник до поворота';

/**
 * Позиция места на плане зала: прямоугольник (x, y, w, h) в целых условных единицах плана (не пикселях),
 * начало координат — левый верхний угол плана, y — вниз; поворот — градусы по часовой стрелке вокруг центра места.
 */
export class VenuePositionDto {
  @ApiProperty({ minimum: 0, description: POSITION_X }) x: number;
  @ApiProperty({ minimum: 0, description: POSITION_Y }) y: number;
  @ApiProperty({ minimum: 1, description: POSITION_W }) w: number;
  @ApiProperty({ minimum: 1, description: POSITION_H }) h: number;
  @ApiProperty({ enum: VENUE_SHAPES, description: POSITION_SHAPE }) shape: VenueShape;
  @ApiProperty({ minimum: 0, maximum: 359, description: POSITION_ROTATION }) rotation: number;
}

export class VenuePositionInputDto {
  @ApiPropertyOptional({ minimum: 0, description: POSITION_X }) @IsOptional() @IsInt() @Min(0) x?: number;
  @ApiPropertyOptional({ minimum: 0, description: POSITION_Y }) @IsOptional() @IsInt() @Min(0) y?: number;
  @ApiPropertyOptional({ minimum: 1, description: POSITION_W }) @IsOptional() @IsInt() @Min(1) w?: number;
  @ApiPropertyOptional({ minimum: 1, description: POSITION_H }) @IsOptional() @IsInt() @Min(1) h?: number;
  @ApiPropertyOptional({ enum: VENUE_SHAPES, description: POSITION_SHAPE }) @IsOptional() @IsIn(VENUE_SHAPES as unknown as string[]) shape?: VenueShape;
  @ApiPropertyOptional({ minimum: 0, maximum: 359, description: POSITION_ROTATION }) @IsOptional() @IsInt() @Min(0) @Max(359) rotation?: number;
}

export class TimeRangeDto {
  @ApiProperty() start: Date;
  @ApiProperty() end: Date;
}
