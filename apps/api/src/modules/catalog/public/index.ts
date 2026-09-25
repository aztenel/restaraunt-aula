/**
 * Публичный контракт модуля Catalog: меню, блюда, категории, модификаторы, цены по филиалам,
 * стоп-лист, контент витрины (баннеры, акции, тексты).
 *
 * Инварианты (ТЗ): цена не хранится в блюде; цена и стоп-лист всегда в разрезе филиала;
 * цена опции модификатора — в тиынах.
 */
import { Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';

export const DishAvailability = {
  /** В меню филиала и доступно к заказу. */
  Available: 'available',
  /** Стоп-лист: показывается, но недоступно к заказу. */
  StoppedShown: 'stopped_shown',
  /** Стоп-лист: скрыто с витрины. */
  StoppedHidden: 'stopped_hidden',
} as const;
export type DishAvailability = (typeof DishAvailability)[keyof typeof DishAvailability];

export interface PricedLineRequest {
  dishId: string;
  quantity: number;
  /** Выбранные опции модификаторов (id опций). */
  modifierOptionIds: string[];
}

export interface PricedModifier {
  groupId: string;
  groupName: Translatable;
  optionId: string;
  optionName: Translatable;
  price: Money;
}

/**
 * Позиция, посчитанная сервером по актуальному меню филиала.
 * Используется как снимок (OrderItem, позиции сметы): изменение меню не меняет прошлые документы.
 */
export interface PricedLine {
  dishId: string;
  dishSlug: string;
  dishName: Translatable;
  categoryId: string;
  photoUrl: string | null;
  weightGrams: number | null;
  quantity: number;
  /** Цена блюда в филиале без модификаторов. */
  basePrice: Money;
  modifiers: PricedModifier[];
  /** Цена за единицу с модификаторами. */
  unitPrice: Money;
  /** unitPrice * quantity. */
  lineTotal: Money;
  /** Внешний код в POS (если сопоставлен) — для передачи на кухню. */
  sku: string | null;
}

export interface DishSummary {
  dishId: string;
  slug: string;
  name: Translatable;
  categoryId: string;
  price: Money;
  availability: DishAvailability;
  photoUrl: string | null;
  weightGrams: number | null;
}

/**
 * Расчёт позиций по меню филиала. Бросает ValidationError с кодами:
 * - 'catalog.dish_not_in_branch_menu' — блюда нет в меню филиала;
 * - 'catalog.dish_unavailable' — блюдо в стоп-листе;
 * - 'catalog.modifier_invalid' — опция не принадлежит блюду, нарушены min/max/обязательность;
 * - 'catalog.quantity_invalid' — количество не целое 1..99.
 */
export abstract class MenuPricing {
  abstract priceLines(branchId: string, lines: PricedLineRequest[]): Promise<PricedLine[]>;
  /** Мягкая проверка: какие позиции сейчас недоступны (для корзины), без исключений. */
  abstract checkAvailability(branchId: string, dishIds: string[]): Promise<Record<string, DishAvailability | 'not_in_menu'>>;
}

/** Блюдо независимо от меню филиала и стоп-листа: название и фото для проблемных позиций корзины. */
export interface DishCard {
  dishId: string;
  slug: string;
  name: Translatable;
  photoUrl: string | null;
  weightGrams: number | null;
}

export interface OrderMenuModifierOption {
  id: string;
  name: Translatable;
  price: Money;
  isDefault: boolean;
}

export interface OrderMenuModifierGroup {
  id: string;
  name: Translatable;
  minSelect: number;
  maxSelect: number;
  isRequired: boolean;
  options: OrderMenuModifierOption[];
}

export interface OrderMenuCategory {
  id: string;
  slug: string;
  name: Translatable;
}

export interface OrderMenuDish {
  dishId: string;
  slug: string;
  categoryId: string;
  name: Translatable;
  price: Money;
  /** Как блюдо видно на витрине с учётом режима стоп-листа филиала. */
  availability: DishAvailability;
  /** Блюдо в стоп-листе (к заказу недоступно) — независимо от режима показа филиала. */
  stopped: boolean;
  stoppedUntil: Date | null;
  stopReason: string | null;
  photoUrl: string | null;
  weightGrams: number | null;
  sku: string | null;
  modifierGroups: OrderMenuModifierGroup[];
}

/** Меню филиала для телефонного заказа: все позиции (включая стоп-лист), с модификаторами. */
export interface BranchOrderMenu {
  branchId: string;
  categories: OrderMenuCategory[];
  dishes: OrderMenuDish[];
}

/** Поиск блюд меню филиала (конструктор банкетной сметы, телефонный заказ в админке). */
export abstract class MenuQuery {
  abstract searchBranchDishes(branchId: string, query: string, limit?: number): Promise<DishSummary[]>;
  abstract getDishes(branchId: string, dishIds: string[]): Promise<DishSummary[]>;
  /** Название и фото блюд по id (активных и нет, в меню филиала или нет); удалённые и несуществующие пропускаются. */
  abstract describeDishes(dishIds: string[]): Promise<DishCard[]>;
  /** Полное меню филиала с модификаторами (блюда из стоп-листа — с флагом stopped). */
  abstract branchOrderMenu(branchId: string): Promise<BranchOrderMenu>;
}

/** Управление стоп-листом извне (синхронизация с POS). */
export abstract class StopListControl {
  abstract setAvailability(
    branchId: string,
    dishId: string,
    available: boolean,
    source: 'manual' | 'pos',
  ): Promise<void>;
  /**
   * Найти блюдо по внешнему коду POS (sku). Код блюда общий для сети (номенклатура сети в POS);
   * если код задан только как переопределение филиала — находится, когда он однозначен во всех филиалах.
   */
  abstract findDishIdBySku(sku: string): Promise<string | null>;

  /**
   * Найти блюдо по коду POS конкретного филиала: сначала переопределение кода в меню филиала,
   * затем общий код блюда. По умолчанию — как findDishIdBySku (для заглушек).
   */
  findDishIdBySkuInBranch(_branchId: string, sku: string): Promise<string | null> {
    return this.findDishIdBySku(sku);
  }
}

export const CatalogEvents = {
  /** Изменилась доступность блюда в филиале (стоп-лист). */
  StopListChanged: 'catalog.stop_list_changed',
  /** Изменились блюда/категории/цены (для сброса кэшей витрины). */
  MenuChanged: 'catalog.menu_changed',
  /** Изменился контент витрины: баннер, акция или статическая страница (для сброса кэшей). */
  ContentChanged: 'catalog.content_changed',
} as const;

export interface StopListChangedPayload {
  branchId: string;
  dishId: string;
  availability: DishAvailability;
  source: 'manual' | 'pos';
  /** До какого момента блюдо в стопе (ISO), null — до ручного возврата. */
  stoppedUntil?: string | null;
  reason?: string | null;
}

export interface MenuChangedPayload {
  branchId: string | null;
  dishId?: string | null;
  categoryId?: string | null;
}

export interface ContentChangedPayload {
  kind: 'banner' | 'promotion' | 'page';
  id: string;
  slug?: string | null;
  /** Филиал баннера/акции; null — весь контент сети. */
  branchId: string | null;
}
