/**
 * Сообщения для клиентских компонентов: в браузер уходят только нужные пространства имён
 * (меньше HTML/JS на мобильном 4G). Серверные компоненты используют все сообщения.
 */
export const CLIENT_NAMESPACES = ['Header', 'Nav', 'Languages', 'Common', 'Cart', 'Map', 'Error'] as const;

export function pickMessages<T extends Record<string, unknown>>(messages: T, namespaces: readonly string[]): Partial<T> {
  const picked: Partial<T> = {};
  for (const ns of namespaces) {
    if (ns in messages) (picked as Record<string, unknown>)[ns] = messages[ns];
  }
  return picked;
}
