/**
 * Формы ответов конфигурации залов (модуль Reservation: apps/api/src/modules/reservation/http/dto/config.dto.ts,
 * common.dto.ts), уточнённые относительно docs/openapi.json: там nullable-поля описаны без `type`, а ImageDto
 * модуля брони конфликтует по имени со схемой каталога (у брони есть thumbnailUrl).
 * Даты — ISO-строки UTC. Суммы — тиыны от сервера.
 */
import type { Money, Translatable } from '@aula/api-client';

export const VENUE_SHAPES = ['rect', 'circle'] as const;
export type VenueShape = (typeof VENUE_SHAPES)[number];

/** Позиция места на плане зала (условные единицы плана, поворот в градусах 0..359). */
export interface VenuePosition {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: VenueShape;
  rotation: number;
}

/** Правила брони места (полный набор): у типа — по умолчанию, у места — действующие. */
export interface VenueRules {
  durationMinutes: number;
  holdMinutes: number;
  cancellationDeadlineHours: number;
  requiresManualConfirmation: boolean;
  cleanupMinutes: number;
  slotStepMinutes: number;
  bookableOnline: boolean;
}

export type RuleKey = keyof VenueRules;
export type NumericRuleKey = 'durationMinutes' | 'holdMinutes' | 'cancellationDeadlineHours' | 'cleanupMinutes' | 'slotStepMinutes';
export type BooleanRuleKey = 'requiresManualConfirmation' | 'bookableOnline';

/** Переопределения правил типа у места: null / отсутствие — «как у типа». */
export type VenueRuleOverrides = { [K in RuleKey]?: VenueRules[K] | null };

export interface ReservationImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  variants: Array<{ width: number; height: number; url: string }>;
}

export interface VenueType {
  id: string;
  code: string;
  name: Translatable;
  description: Translatable;
  rules: VenueRules;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VenueTypeInput {
  code: string;
  name: Translatable;
  description?: Translatable | null;
  rules: VenueRules;
  sortOrder?: number;
  isActive?: boolean;
}

export interface Hall {
  id: string;
  branchId: string;
  code: string;
  name: Translatable;
  description: Translatable;
  planWidth: number;
  planHeight: number;
  background: ReservationImage | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HallInput {
  branchId: string;
  code: string;
  name: Translatable;
  description?: Translatable | null;
  planWidth?: number;
  planHeight?: number;
  sortOrder?: number;
  isActive?: boolean;
}

export type HallPatch = Partial<Omit<HallInput, 'branchId'>>;

export interface Venue {
  id: string;
  branchId: string;
  hallId: string;
  hallName: Translatable;
  typeId: string;
  typeCode: string;
  typeName: Translatable;
  code: string;
  name: Translatable;
  description: Translatable;
  capacityMin: number;
  capacityMax: number;
  /** Минимальный депозит (онлайн-предоплата); null — без депозита. */
  deposit: Money | null;
  ruleOverrides: VenueRuleOverrides;
  /** Действующие правила (тип + переопределения) — считает сервер. */
  rules: VenueRules;
  position: VenuePosition;
  photos: ReservationImage[];
  sortOrder: number;
  isActive: boolean;
  /** Доступно для брони: активны место, зал и тип. */
  isBookable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MoneyInputValue {
  amount: number;
  currency: 'KZT';
}

export interface VenueInput {
  hallId: string;
  typeId: string;
  code: string;
  name: Translatable;
  description?: Translatable | null;
  capacityMin: number;
  capacityMax: number;
  deposit?: MoneyInputValue | null;
  /** Полная замена переопределений; null — всё как у типа. */
  rules?: VenueRuleOverrides | null;
  position?: Partial<VenuePosition>;
  sortOrder?: number;
  isActive?: boolean;
}

export type VenuePatch = Partial<VenueInput>;

export interface ReservationSettings {
  branchId: string;
  reminderHoursBefore: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
  policyText: Translatable;
  updatedAt: string | null;
}

export type ReservationSettingsInput = Partial<Omit<ReservationSettings, 'branchId' | 'updatedAt'>>;
