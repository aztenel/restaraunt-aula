/**
 * Модуль POS: адаптер кассовой системы точки (передача заказа на кухню, синхронизация стоп-листа).
 * Работает через события Ordering и публичные сервисы Catalog. Публичных сервисов не предоставляет.
 */
export const PosEvents = {
  OrderSentToPos: 'pos.order_sent',
  OrderPosFailed: 'pos.order_failed',
} as const;

export interface OrderSentToPosPayload {
  orderId: string;
  branchId: string;
  posOrderId: string;
  provider: string;
  occurredAt: string;
}

/**
 * Почему заказ не передан в POS:
 * - missing_mapping — у блюда или опции модификатора нет сопоставления с товаром POS;
 * - not_configured — интеграция POS филиала не настроена (маршрутизация, ключи, организация);
 * - rejected — POS отклонила заказ (ошибка данных, повтор бессмыслен);
 * - retries_exhausted — POS недоступна, повторы исчерпаны;
 * - order_unavailable — заказ не удалось получить из модуля заказов.
 */
export type PosFailureReason = 'missing_mapping' | 'not_configured' | 'rejected' | 'retries_exhausted' | 'order_unavailable';

/** Заказ не передан в POS. Сам заказ продолжает обрабатываться: кухня работает по экрану админки. */
export interface OrderPosFailedPayload {
  orderId: string;
  /** Номер заказа (GL-2026-000123). */
  number: string;
  branchId: string;
  provider: string;
  reason: PosFailureReason;
  error: string;
  attempts: number;
  occurredAt: string;
}
