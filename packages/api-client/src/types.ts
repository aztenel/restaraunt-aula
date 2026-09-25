/**
 * Доменные типы поверх сгенерированной схемы.
 *
 * Часть полей в docs/openapi.json описана неточно (nullable-поля без `type`, объект часов работы
 * без схемы), из-за чего openapi-typescript выводит `Record<string, never>`. Здесь — уточнённые типы,
 * совпадающие с тем, что реально отдаёт бэкенд (apps/api/src/modules/identity/http/dto.ts).
 * Когда DTO на бэкенде получат явные `type: String` / схемы, уточнения можно будет убрать.
 */
import type { Translatable } from './i18n';
import type { Money } from './money';
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

// ---------------------------------------------------------------- Каталог и контент (модуль Catalog)
//
// Уточнённые формы DTO каталога (apps/api/src/modules/catalog/http/dto/*.ts). В docs/openapi.json
// nullable-поля (slug, sku, weightGrams, stoppedUntil, linkUrl, activeFrom...) описаны без `type`,
// а необязательные входные поля с default (isActive, isHalal...) — как обязательные `Record<string, never>`.

/** Вариант изображения (webp фиксированной ширины). */
export interface CatalogImageVariant {
  width: number;
  height: number;
  url: string;
}

/** Изображение: url варианта по умолчанию и все варианты (для srcset). */
export interface CatalogImage {
  id: string;
  url: string;
  width: number;
  height: number;
  variants: CatalogImageVariant[];
}

export interface DishPhoto extends CatalogImage {
  sortOrder: number;
}

/** Недостающие переводы поля (kk/ru) — считает сервер. */
export interface MissingTranslation {
  field: string;
  missing: Array<'kk' | 'ru' | 'en'>;
}

export interface Category {
  id: string;
  slug: string;
  name: Translatable;
  description: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  image: CatalogImage | null;
  sortOrder: number;
  isActive: boolean;
  dishCount: number;
  missingTranslations: MissingTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInput {
  /** null — транслитерация из названия (новая категория) или без изменений (существующая). */
  slug?: string | null;
  name: Translatable;
  description?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export type MenuItemAvailability = 'available' | 'stopped';
/** Как блюдо видно на витрине с учётом настройки филиала stopListMode. */
export type DisplayAvailability = 'available' | 'stopped_shown' | 'stopped_hidden';
export type StopSource = 'manual' | 'pos';

/** Цена блюда в филиале (в карточке блюда). */
export interface DishBranchPrice {
  branchId: string;
  price: Money;
  availability: MenuItemAvailability;
  stoppedUntil: string | null;
  sku: string | null;
}

export interface Dish {
  id: string;
  slug: string;
  categoryId: string;
  name: Translatable;
  description: Translatable;
  composition: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  weightGrams: number | null;
  calories: number | null;
  isVegetarian: boolean;
  /** 0..3 */
  spicyLevel: number;
  isHalal: boolean;
  allergens: string[];
  /** Общий код блюда в POS сети. */
  sku: string | null;
  sortOrder: number;
  isActive: boolean;
  photos: DishPhoto[];
  modifierGroupIds: string[];
  missingTranslations: MissingTranslation[];
  /** Только в карточке блюда (GET /dishes/{id}). */
  branchPrices?: DishBranchPrice[];
  createdAt: string;
  updatedAt: string;
}

export interface DishInput {
  slug?: string | null;
  categoryId: string;
  name: Translatable;
  description?: Translatable | null;
  composition?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  weightGrams?: number | null;
  calories?: number | null;
  isVegetarian?: boolean | null;
  spicyLevel?: number | null;
  isHalal?: boolean | null;
  allergens?: string[] | null;
  sku?: string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
  /** Порядок показа; не передано — без изменений. */
  modifierGroupIds?: string[] | null;
}

export interface AllergenRef {
  code: string;
  name: Translatable;
}

export interface ModifierOption {
  id: string;
  name: Translatable;
  price: Money;
  isDefault: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface ModifierGroup {
  id: string;
  code: string;
  name: Translatable;
  description: Translatable;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  sortOrder: number;
  isActive: boolean;
  options: ModifierOption[];
  dishCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ModifierOptionInput {
  /** Существующая опция; не задан — новая. */
  id?: string | null;
  name: Translatable;
  /** Доплата в тиынах. */
  price: { amount: number; currency?: Money['currency'] };
  isDefault?: boolean | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface ModifierGroupInput {
  code?: string | null;
  name: Translatable;
  description?: Translatable | null;
  minSelect: number;
  maxSelect: number;
  sortOrder?: number | null;
  isActive?: boolean | null;
  /** Полный список опций: отсутствующие удаляются. */
  options: ModifierOptionInput[];
}

/** Позиция меню филиала (GET /admin/catalog/branches/{branchId}/menu). */
export interface BranchMenuItem {
  branchId: string;
  dishId: string;
  dishSlug: string;
  dishName: Translatable;
  categoryId: string;
  dishIsActive: boolean;
  photo: CatalogImage | null;
  price: Money;
  availability: MenuItemAvailability;
  displayAvailability: DisplayAvailability;
  stoppedUntil: string | null;
  stopReason: string | null;
  stopSource: StopSource | null;
  stoppedAt: string | null;
  /** Код POS филиала (переопределение). */
  sku: string | null;
  /** Код, который уходит в POS. */
  effectiveSku: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AddMenuItemInput {
  dishId: string;
  price: { amount: number; currency?: Money['currency'] };
  sku?: string | null;
}

export interface SetMenuPriceInput {
  price: { amount: number; currency?: Money['currency'] };
  /** Не передан — без изменений, null — сбросить. */
  sku?: string | null;
}

export interface BulkPricesResult {
  updated: number;
  unchanged: number;
}

export interface CopyMenuResult {
  added: number;
  updated: number;
  unchanged: number;
}

export interface SetAvailabilityInput {
  available: boolean;
  /** ISO 8601; не задан — до ручного возврата. */
  until?: string | null;
  /** До полуночи по времени филиала (считает сервер). */
  untilEndOfDay?: boolean;
  reason?: string | null;
}

export interface AvailabilityResult {
  changed: boolean;
  item: BranchMenuItem;
}

export type TranslationEntityType = 'category' | 'dish' | 'modifier_group' | 'modifier_option' | 'banner' | 'promotion' | 'page';

export interface TranslationGap {
  entityType: TranslationEntityType;
  entityId: string;
  label: string;
  field: string;
  missing: Array<'kk' | 'ru' | 'en'>;
}

export interface TranslationSummary {
  entityType: TranslationEntityType;
  total: number;
  incomplete: number;
}

export interface TranslationReport {
  locales: Array<'kk' | 'ru' | 'en'>;
  summary: TranslationSummary[];
  items: TranslationGap[];
}

export type BannerPlacement = 'home_hero' | 'home_secondary' | 'menu_top';

export interface Banner {
  id: string;
  placement: BannerPlacement;
  /** null — для всех филиалов. */
  branchId: string | null;
  title: Translatable;
  subtitle: Translatable;
  ctaLabel: Translatable;
  linkUrl: string | null;
  image: CatalogImage | null;
  activeFrom: string | null;
  activeTo: string | null;
  sortOrder: number;
  isActive: boolean;
  missingTranslations: MissingTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface BannerInput {
  placement: BannerPlacement;
  branchId?: string | null;
  title: Translatable;
  subtitle?: Translatable | null;
  ctaLabel?: Translatable | null;
  linkUrl?: string | null;
  activeFrom?: string | null;
  activeTo?: string | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

export interface Promotion {
  id: string;
  slug: string;
  title: Translatable;
  description: Translatable;
  terms: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  image: CatalogImage | null;
  validFrom: string | null;
  validTo: string | null;
  /** Пусто — во всех филиалах. */
  branchIds: string[];
  sortOrder: number;
  isActive: boolean;
  missingTranslations: MissingTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface PromotionInput {
  slug?: string | null;
  title: Translatable;
  description?: Translatable | null;
  terms?: Translatable | null;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  validFrom?: string | null;
  validTo?: string | null;
  branchIds?: string[] | null;
  sortOrder?: number | null;
  isActive?: boolean | null;
}

/** Статическая страница витрины (оферта, доставка...). body — HTML, санитизированный сервером. */
export interface ContentPage {
  id: string;
  slug: string;
  title: Translatable;
  body: Translatable;
  seoTitle: Translatable;
  seoDescription: Translatable;
  isPublished: boolean;
  /** Юридическая страница: нельзя удалить, снять с публикации или сменить slug. */
  isProtected: boolean;
  sortOrder: number;
  missingTranslations: MissingTranslation[];
  createdAt: string;
  updatedAt: string;
}

export interface ContentPageInput {
  slug?: string | null;
  title: Translatable;
  body: Translatable;
  seoTitle?: Translatable | null;
  seoDescription?: Translatable | null;
  isPublished?: boolean | null;
  sortOrder?: number | null;
}
