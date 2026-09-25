/**
 * Кнопки действий над заказом — только из того, что разрешил сервер (allowedTransitions, canCancel,
 * canReject). Фронт не знает автомата статусов: он лишь сопоставляет разрешённый переход с кнопкой.
 */
import { STAFF_TRANSITION_TARGETS, type StaffTransitionTarget } from './types';

export type OrderActionKey = 'accept' | 'startCooking' | 'markReady' | 'dispatch' | 'complete' | 'reject' | 'cancel';

export interface OrderAction {
  key: OrderActionKey;
  /** Переход для POST /orders/{id}/transition; null — отдельное действие (отказ, отмена с причиной). */
  to: StaffTransitionTarget | null;
  /** primary — главная кнопка карточки, default — прочие переходы, danger — отказ и отмена. */
  emphasis: 'primary' | 'default' | 'danger';
}

/** Переход → кнопка: «Принять», «Готовить», «Готов», «Передать курьеру», «Выполнен». */
export const TRANSITION_ACTIONS: Record<StaffTransitionTarget, OrderActionKey> = {
  accepted: 'accept',
  cooking: 'startCooking',
  ready: 'markReady',
  delivering: 'dispatch',
  completed: 'complete',
};

export interface ActionFlags {
  /** Сервер разрешил отказ от оплаченного заказа (canReject). */
  canReject?: boolean;
  /** Сервер разрешил отмену (canCancel); иначе — по 'cancelled' в allowedTransitions. */
  canCancel?: boolean;
}

/**
 * Разрешённые сервером переходы → кнопки. Неизвестные статусы игнорируются; первая кнопка перехода —
 * главная. Отмена (переход в cancelled) — отдельное действие с причиной, не POST /transition.
 */
export function actionsFromTransitions(allowed: readonly string[], flags: ActionFlags = {}): OrderAction[] {
  const actions: OrderAction[] = STAFF_TRANSITION_TARGETS.filter((to) => allowed.includes(to)).map((to, index) => ({
    key: TRANSITION_ACTIONS[to],
    to,
    emphasis: index === 0 ? 'primary' : 'default',
  }));
  if (flags.canReject) actions.push({ key: 'reject', to: null, emphasis: 'danger' });
  if (flags.canCancel ?? allowed.includes('cancelled')) actions.push({ key: 'cancel', to: null, emphasis: 'danger' });
  return actions;
}

/**
 * Кнопки карточки очереди. В ответе очереди нет флага canReject: отказ — это переходы paid → accepted →
 * cancelled, поэтому он предлагается, когда сервер разрешил сотруднику первый шаг (accepted из paid).
 * Окончательно отказ проверяет сервер (диалог отказа загружает карточку заказа с canReject).
 */
export function queueCardActions(card: { status: string; allowedTransitions: readonly string[] }): OrderAction[] {
  const canReject = card.status === 'paid' && card.allowedTransitions.includes('accepted');
  return actionsFromTransitions(card.allowedTransitions, { canReject });
}

/** Кнопки карточки заказа: переходы и флаги из GET /admin/orders/{id}. */
export function detailActions(order: {
  allowedTransitions: readonly string[];
  canCancel: boolean;
  canReject: boolean;
}): OrderAction[] {
  return actionsFromTransitions(order.allowedTransitions, { canReject: order.canReject, canCancel: order.canCancel });
}
