/**
 * Доменные типы поверх сгенерированной схемы.
 *
 * Часть полей в docs/openapi.json описана неточно (nullable-поля без `type`, объект часов работы
 * без схемы), из-за чего openapi-typescript выводит `Record<string, never>`. Здесь — уточнённые типы,
 * совпадающие с тем, что реально отдаёт бэкенд (apps/api/src/modules/identity/http/dto.ts).
 * Когда DTO на бэкенде получат явные `type: String` / схемы, уточнения можно будет убрать.
 */
import type { Translatable } from './i18n';
import type { components } from './schema';

export type Schemas = components['schemas'];

/** Страница списка — единый формат API. */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Интервал работы в локальном времени филиала ('HH:mm').
 * close <= open — интервал переходит через полночь ({ open: '10:00', close: '02:00' }).
 */
export interface OpeningInterval {
  open: string;
  close: string;
}
export type OpeningHours = Partial<Record<Weekday, OpeningInterval[]>>;

export type PaymentMethodOption = 'online' | 'on_receipt';
export type StopListMode = 'hide' | 'mark_unavailable';

/** Публичное представление филиала (GET /api/v1/public/branches). */
export interface PublicBranch {
  id: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  location: GeoPoint;
  phone: string;
  whatsapp: string | null;
  timezone: string;
  openingHours: OpeningHours;
  /** Посчитано сервером по часам работы в часовом поясе филиала. */
  isOpenNow: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  acceptsReservations: boolean;
  paymentMethods: PaymentMethodOption[] | string[];
  stopListMode: StopListMode | string;
}

export const STAFF_ROLES = [
  'branch_operator',
  'banquet_manager',
  'branch_manager',
  'content_manager',
  'finance',
  'owner',
  'sysadmin',
] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface RoleAssignment {
  role: StaffRole;
  /** Филиал для филиальных ролей; null для глобальных. */
  branchId: string | null;
}

export interface RoleDefinition {
  role: StaffRole;
  scope: 'branch' | 'global';
  title: { ru: string; kk: string };
  permissions: string[];
}

/** GET /api/v1/admin/auth/me */
export interface Me {
  id: string;
  name: string;
  email: string;
  mustChangePassword: boolean;
  roles: RoleAssignment[];
  /** Права во всех филиалах. */
  globalPermissions: string[];
  /** Права по филиалам: { branchId: [permission, ...] }. */
  branchPermissions: Record<string, string[]>;
  /** Филиалы, доступные пользователю (для переключателя). */
  branchIds: string[];
}

export interface Session {
  accessToken: string;
  /** Время жизни access-токена, секунд. */
  expiresIn: number;
  mustChangePassword: boolean;
}

export interface StaffUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  telegramChatId: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleAssignment[];
}

export interface BranchSettings {
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  acceptsReservations: boolean;
  deliveryLeadMinutes: number;
  pickupLeadMinutes: number;
  maxScheduleDaysAhead: number;
  stopListMode: StopListMode;
  paymentMethods: PaymentMethodOption[];
  awaitingPaymentTimeoutMinutes: number;
  requirePhoneVerificationForOnReceipt: boolean;
  requirePhoneVerificationForReservations: boolean;
  staffNotifyPhone: string | null;
  staffTelegramChatId: string | null;
}

/** Филиал в админке (GET /api/v1/admin/branches). */
export interface Branch {
  id: string;
  code: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  location: GeoPoint;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  timezone: string;
  openingHours: OpeningHours;
  settings: BranchSettings;
  legalEntityId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export type BranchInput = Omit<Branch, 'id' | 'settings' | 'timezone' | 'isActive' | 'sortOrder'> & {
  timezone?: string;
  settings?: Partial<BranchSettings>;
  isActive?: boolean;
  sortOrder?: number;
};

export interface LegalEntity {
  id: string;
  name: string;
  shortName: string;
  bin: string;
  legalAddress: string;
  actualAddress: string | null;
  directorName: string;
  directorPosition: string;
  actingBasis: string;
  bankName: string;
  iban: string;
  bik: string;
  kbe: string;
  vatPayer: boolean;
  /** Ставка НДС в базисных пунктах (1600 = 16%). */
  vatRateBp: number;
  vatCertificate: string | null;
  phone: string | null;
  email: string | null;
  isDefault?: boolean;
}

export type LegalEntityInput = Omit<LegalEntity, 'id'>;

/** Поле настройки интеграции (каталог адаптеров, GET /admin/system/integrations/catalog). */
export interface IntegrationField {
  name: string;
  label: string;
  type: 'string' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  secret?: boolean;
  required?: boolean;
  options?: string[];
  help?: string;
}

export type IntegrationCategory =
  | 'payments'
  | 'notifications'
  | 'pos'
  | 'delivery'
  | 'accounting'
  | 'esf'
  | 'geocoding'
  | 'analytics'
  | 'other';

export interface IntegrationDescriptor {
  /** '<модуль>.<провайдер>' */
  key: string;
  title: string;
  category: IntegrationCategory;
  stage: 1 | 2 | 3;
  description: string;
  fields: IntegrationField[];
}

export interface IntegrationSetting {
  key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Маскированные секреты. */
  secrets: Record<string, string>;
  updatedAt: string | null;
}

export interface SaveIntegrationSetting {
  enabled: boolean;
  config: Record<string, unknown>;
  /** Новые значения; пустая строка или null — удалить; отсутствие ключа — оставить прежнее. */
  secrets?: Record<string, string | null>;
}

/** Запись журнала действий (GET /admin/system/audit-log). */
export interface AuditRecord {
  id: string;
  occurredAt: string;
  actorKind: 'staff' | 'system' | 'guest' | string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  branchId: string | null;
  before: unknown;
  after: unknown;
  meta: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
}

/** Очередь неудач (GET /admin/system/failed-jobs). */
export interface FailedJob {
  id: string;
  kind: string;
  topic: string;
  handler: string | null;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: string;
  retriedAt: string | null;
  resolvedAt: string | null;
}

/** Журнал обменов с внешними системами — строки таблицы как есть (snake_case). */
export interface IntegrationLogRecord {
  id: string;
  occurred_at: string;
  integration: string;
  direction: 'outbound' | 'inbound';
  operation: string;
  correlation_id: string | null;
  request: unknown;
  response: unknown;
  status_code: number | null;
  success: boolean;
  duration_ms: number | null;
  error: string | null;
}
