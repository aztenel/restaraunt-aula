import { StateMachine, TransitionMap } from '../../../shared/kernel/state-machine';
import { OrderStatus, OrderType } from '../public';

/**
 * Автомат статусов заказа — строго по схеме ТЗ (раздел «2. Заказ доставки и самовывоза»):
 *
 *   draft → awaiting_payment → paid → accepted → cooking → ready → (delivering →) completed
 *   отмена только из awaiting_payment и accepted; cancelled → refunded.
 *
 * Других переходов нет. Отказ ресторана от оплаченного заказа — два разрешённых перехода
 * paid → accepted → cancelled в одной транзакции (docs/decisions.md).
 *
 * Уточнение по типу заказа (схема ТЗ разрешает из ready и delivering, и completed):
 * заказ доставки обязательно проходит delivering (ready → completed для него запрещён),
 * заказ самовывоза не может быть «в пути» (ready → delivering для него запрещён).
 */
export const ORDER_TRANSITIONS: TransitionMap<OrderStatus> = {
  draft: ['awaiting_payment'],
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['accepted'],
  accepted: ['cooking', 'cancelled'],
  cooking: ['ready'],
  ready: ['delivering', 'completed'],
  delivering: ['completed'],
  completed: [],
  cancelled: ['refunded'],
  refunded: [],
};

export const ORDER_FSM = new StateMachine<OrderStatus>('order', ORDER_TRANSITIONS);

/** Переходы, запрещённые для типа заказа поверх схемы ТЗ. */
const FORBIDDEN_BY_TYPE: Record<OrderType, ReadonlyArray<[OrderStatus, OrderStatus]>> = {
  delivery: [['ready', 'completed']],
  pickup: [['ready', 'delivering']],
};

/** Разрешён ли переход с учётом схемы ТЗ и типа заказа. */
export function canTransitionOrder(type: OrderType, from: OrderStatus, to: OrderStatus): boolean {
  if (!ORDER_FSM.canTransition(from, to)) return false;
  return !FORBIDDEN_BY_TYPE[type].some(([f, t]) => f === from && t === to);
}

/** Переходы, которые сотрудник выполняет действием «сменить статус» (остальные — оплата, отмена, возврат). */
export const STAFF_TRANSITION_TARGETS = ['accepted', 'cooking', 'ready', 'delivering', 'completed'] as const satisfies readonly OrderStatus[];
export type StaffTransitionTarget = (typeof STAFF_TRANSITION_TARGETS)[number];

/** Активные заказы — очередь оператора. */
export const ACTIVE_ORDER_STATUSES = ['awaiting_payment', 'paid', 'accepted', 'cooking', 'ready', 'delivering'] as const satisfies readonly OrderStatus[];

/** Статусы, из которых возможна отмена (по схеме ТЗ). */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = ['awaiting_payment', 'accepted'];

/**
 * Статусы, в которых допустим частичный возврат без смены статуса (недовложение и т.п.): от принятия до
 * выполнения. Возвраты по отменённому заказу запрашиваются при отмене (и переводят его в refunded).
 */
export const PARTIAL_REFUND_STATUSES: readonly OrderStatus[] = ['accepted', 'cooking', 'ready', 'delivering', 'completed'];

/** Порядок статусов для отображения таймлайна и группировки очереди. */
export const ORDER_STATUS_ORDER: readonly OrderStatus[] = [
  'draft',
  'awaiting_payment',
  'paid',
  'accepted',
  'cooking',
  'ready',
  'delivering',
  'completed',
  'cancelled',
  'refunded',
];

/** Коды причин отмены (ТЗ: отчёт «отменённые заказы и причины»). */
export const CANCEL_REASON_CODES = ['guest_request', 'not_paid_in_time', 'out_of_stock', 'cannot_deliver', 'duplicate', 'other'] as const;
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

export function isCancelReasonCode(value: unknown): value is CancelReasonCode {
  return typeof value === 'string' && (CANCEL_REASON_CODES as readonly string[]).includes(value);
}
