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
