/**
 * Сообщения для клиентских компонентов: в браузер уходят только нужные пространства имён
 * (меньше HTML/JS на мобильном 4G). Серверные компоненты используют все сообщения.
 * Общие (шапка, навигация, ошибки) — на всех страницах; остальные — только на страницах,
 * где есть соответствующие клиентские компоненты (components/i18n/ClientMessages.tsx).
 */
export const CLIENT_NAMESPACES = ['Header', 'Nav', 'Languages', 'Common', 'Map', 'Error'] as const;

/** Меню: «В корзину», выбор добавок, фильтры. */
export const MENU_CLIENT_NAMESPACES = ['Dish', 'Filters'] as const;
/** Корзина: расчёт на сервере, проблемы позиций. */
export const CART_CLIENT_NAMESPACES = ['Cart', 'OrderProblems', 'ApiErrors'] as const;
/** Сертификаты: покупка, проверка баланса, статус заказа. */
export const CERTIFICATE_CLIENT_NAMESPACES = ['Certificates', 'CertificateForm', 'CertificateCheck', 'CertificateOrder', 'ApiErrors'] as const;

export function pickMessages<T extends Record<string, unknown>>(messages: T, namespaces: readonly string[]): Partial<T> {
  const picked: Partial<T> = {};
  for (const ns of namespaces) {
    if (ns in messages) (picked as Record<string, unknown>)[ns] = messages[ns];
  }
  return picked;
}
