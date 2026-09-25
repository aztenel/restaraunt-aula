import { GeoPoint } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { OrderStatus } from '../public';

/**
 * Интерфейс службы курьеров (правило 4 ТЗ: интеграции только за интерфейсом). Реализации —
 * в infrastructure/adapters/<провайдер>: свои курьеры (по умолчанию, ничего не вызывают) и внешняя
 * служба доставки (этап 3). Выбор службы для филиала — настройка ordering.courier_routing, а не код.
 *
 * createClaim/getClaim/confirmClaim/cancelClaim ходят во внешнюю систему и вызываются только
 * из фоновых задач (@JobHandler). Ошибки внешней системы — ExternalServiceError(retryable).
 */
export const CourierDispatchStatus = {
  /** Заявка ещё не создана у службы (задача в очереди). */
  Requested: 'requested',
  /** Служба оценивает стоимость. */
  Estimating: 'estimating',
  /** Оценка готова, заявку нужно подтвердить. */
  AwaitingConfirmation: 'awaiting_confirmation',
  /** Подтверждена, идёт поиск курьера. */
  Searching: 'searching',
  /** Курьер назначен / едет в ресторан. */
  CourierAssigned: 'courier_assigned',
  /** Курьер забрал заказ. */
  PickedUp: 'picked_up',
  Delivered: 'delivered',
  Cancelled: 'cancelled',
  Failed: 'failed',
} as const;
export type CourierDispatchStatus = (typeof CourierDispatchStatus)[keyof typeof CourierDispatchStatus];
export const COURIER_DISPATCH_STATUSES = Object.values(CourierDispatchStatus);

const TERMINAL: ReadonlySet<CourierDispatchStatus> = new Set(['delivered', 'cancelled', 'failed']);

export function isTerminalDispatchStatus(status: CourierDispatchStatus): boolean {
  return TERMINAL.has(status);
}

/** Свои курьеры (доставка без внешней службы) — провайдер по умолчанию. */
export const OWN_COURIER_PROVIDER = 'own';

export interface CourierClaimRequest {
  /** Идентификатор заявки у нас — ключ идемпотентности у службы. */
  dispatchId: string;
  orderId: string;
  orderNumber: string;
  branchId: string;
  pickup: { name: string; phone: string; address: string; location: GeoPoint };
  dropoff: {
    name: string | null;
    phone: string;
    address: string;
    location: GeoPoint;
    apartment: string | null;
    entrance: string | null;
    floor: string | null;
    intercom: string | null;
    comment: string | null;
  };
  items: Array<{ title: string; quantity: number; unitPrice: Money }>;
  total: Money;
  /** Сколько получить с гостя при передаче (оплата при получении), null — заказ оплачен. */
  collectOnDelivery: Money | null;
  contactless: boolean;
  /** Доставить к сроку (заказ ко времени), null — как можно скорее. */
  dueAt: Date | null;
  comment: string | null;
}

export interface CourierClaimRef {
  externalId: string;
  branchId: string;
  orderId: string;
  /** Уже известные данные заявки: адаптер не запрашивает их у службы повторно при каждом опросе. */
  known?: { trackingUrl: string | null; courierPhone: string | null };
}

export interface CourierClaimInfo {
  externalId: string;
  status: CourierDispatchStatus;
  /** Статус в терминах службы — для журнала и поддержки. */
  providerStatus: string;
  trackingUrl: string | null;
  courierName: string | null;
  courierPhone: string | null;
  price: Money | null;
}

export abstract class CourierDispatch {
  abstract readonly provider: string;
  /** false — свои курьеры: заявки у внешней службы не создаются, доставку ведёт оператор. */
  abstract readonly external: boolean;
  abstract createClaim(request: CourierClaimRequest): Promise<CourierClaimInfo>;
  abstract getClaim(ref: CourierClaimRef): Promise<CourierClaimInfo>;
  /** Подтвердить заявку после оценки (если служба этого требует). */
  abstract confirmClaim(ref: CourierClaimRef): Promise<CourierClaimInfo>;
  abstract cancelClaim(ref: CourierClaimRef): Promise<void>;
}

/**
 * Какой переход заказа следует из статуса заявки: курьер забрал — заказ «в пути»,
 * доставлено — заказ выполнен (из ready сначала delivering: доставка всегда проходит delivering).
 */
export function orderTransitionsForDispatch(dispatch: CourierDispatchStatus, order: OrderStatus): Array<'delivering' | 'completed'> {
  if (dispatch === 'picked_up' && order === 'ready') return ['delivering'];
  if (dispatch === 'delivered') {
    if (order === 'ready') return ['delivering', 'completed'];
    if (order === 'delivering') return ['completed'];
  }
  return [];
}

/** Сколько опрашивать статус заявки: после этого срока опрос прекращается, заявка считается неудачной. */
export const DISPATCH_POLL_WINDOW_MS = 12 * 60 * 60_000;
export const DISPATCH_POLL_INTERVAL_MS = 30_000;
export const DISPATCH_CREATE_MAX_ATTEMPTS = 6;
