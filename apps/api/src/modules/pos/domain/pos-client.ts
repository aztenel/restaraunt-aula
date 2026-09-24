import { KitchenOrder } from '../../ordering/public';

/**
 * Интерфейс кассовой системы точки (правило 4 ТЗ: интеграции только за интерфейсом).
 * Реализации — в infrastructure/adapters/<провайдер>. Модуль заказов о POS не знает:
 * выбор POS филиала — настройка pos.routing, а не код.
 *
 * pushOrder, fetchStopList и fetchProducts ходят во внешнюю систему и вызываются только
 * из фоновых задач (@JobHandler). Ошибки внешней системы — ExternalServiceError(retryable),
 * ненастроенная интеграция — ValidationError с кодом POS_NOT_CONFIGURED.
 */

/** Код ошибки «интеграция POS не настроена для филиала». */
export const POS_NOT_CONFIGURED = 'pos.not_configured';

/** Что умеет POS. У части POS нет открытого API — тогда кухня работает по экрану админки. */
export interface PosCapabilities {
  /** Передаёт заказы на кухню во внешнюю систему. */
  pushOrders: boolean;
  /** Отдаёт стоп-лист для синхронизации с витриной. */
  stopList: boolean;
  /** Отдаёт номенклатуру для сопоставления блюд с товарами POS. */
  nomenclature: boolean;
}

/** Филиал, для которого выполняется операция (настройки филиала адаптер читает сам). */
export interface PosBranchRef {
  branchId: string;
}

export interface PosOrderModifierLine {
  optionId: string;
  externalProductId: string;
  /** Группа модификаторов в POS (для групповых модификаторов), если POS её требует. */
  externalGroupId: string | null;
  /** Количество модификатора на одну единицу позиции. */
  amount: number;
}

/** Позиция заказа, сопоставленная с товаром POS. */
export interface PosOrderLine {
  dishId: string;
  externalProductId: string;
  quantity: number;
  /** Название блюда для комментариев и журналов (не для кухни — кухня видит название из POS). */
  name: string;
  modifiers: PosOrderModifierLine[];
}

/** Сопоставление заказа с номенклатурой POS: строки в порядке позиций заказа. */
export interface PosOrderMapping {
  lines: PosOrderLine[];
  /** Часовой пояс филиала (время «к сроку» POS принимает в локальном времени точки). */
  timezone: string;
}

export interface PosPushResult {
  /** Идентификатор заказа в POS. */
  posOrderId: string;
}

/** Позиция стоп-листа POS: только товары, которые POS сообщила (остальные доступны). */
export interface PosStopListItem {
  externalProductId: string;
  available: boolean;
}

export const POS_PRODUCT_KINDS = ['dish', 'good', 'modifier', 'service', 'other'] as const;
export type PosProductKind = (typeof POS_PRODUCT_KINDS)[number];

/** Товар номенклатуры POS (для экрана сопоставления). */
export interface PosProduct {
  externalProductId: string;
  name: string;
  sku: string | null;
  kind: PosProductKind;
  groupName: string | null;
}

export abstract class PosClient {
  /** Имя провайдера (ключ настроек pos.<provider>, значение в pos.routing). */
  abstract readonly provider: string;
  abstract readonly capabilities: PosCapabilities;

  /** Настроена ли интеграция для филиала (без обращения во внешнюю систему). */
  abstract isConfigured(branch: PosBranchRef): Promise<boolean>;

  /** Передать заказ на кухню. */
  abstract pushOrder(order: KitchenOrder, mapping: PosOrderMapping): Promise<PosPushResult>;

  /** Текущий стоп-лист точки. */
  abstract fetchStopList(branch: PosBranchRef): Promise<PosStopListItem[]>;

  /** Номенклатура POS (для экрана сопоставления). */
  abstract fetchProducts(branch: PosBranchRef): Promise<PosProduct[]>;
}
