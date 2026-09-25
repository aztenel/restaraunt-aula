/**
 * Идентификатор сессии витрины (uuid в localStorage) — для конверсии «сессии витрины → заказы»
 * в отчётах. Передаётся в заказ (analyticsSessionId) и в события витрины
 * (POST /api/v1/public/analytics/events, модуль Reporting). Персональных данных нет.
 */
import { getBrowserApiUrl } from './config';
import { randomUuid } from './uuid';
export const ANALYTICS_SESSION_KEY = 'aula_asid';

let memoryId: string | null = null;

/** uuid сессии; создаётся при первом обращении. null — на сервере. */
export function getAnalyticsSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const existing = window.localStorage.getItem(ANALYTICS_SESSION_KEY);
    if (existing) return existing;
    const id = randomUuid();
    window.localStorage.setItem(ANALYTICS_SESSION_KEY, id);
    return id;
  } catch {
    memoryId ??= randomUuid();
    return memoryId;
  }
}

/** Типы событий витрины (StorefrontEventType модуля Reporting). */
export type StorefrontEventType = 'page_view' | 'menu_view' | 'dish_view' | 'add_to_cart' | 'checkout_start';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Отправить событие витрины. Не блокирует и не бросает ошибок (аналитика не должна мешать гостю).
 * Переходы на витрине клиентские (страница не выгружается), поэтому keepalive не нужен.
 * path — без префикса языка и параметров.
 */
export function trackStorefrontEvent(type: StorefrontEventType, input: { path: string; branchId?: string | null }): void {
  if (typeof window === 'undefined') return;
  const sessionId = getAnalyticsSessionId();
  if (!sessionId || !UUID_RE.test(sessionId)) return;
  const body = {
    sessionId,
    type,
    path: input.path.split('?')[0]!.slice(0, 300) || '/',
    ...(input.branchId && UUID_RE.test(input.branchId) ? { branchId: input.branchId } : {}),
  };
  try {
    void fetch(`${getBrowserApiUrl()}/api/v1/public/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
    })
      // Тело ответа не нужно: освобождаем поток, иначе соединение остаётся занятым.
      .then((response) => response.body?.cancel())
      .catch(() => undefined);
  } catch {
    // no-op
  }
}

/** Тип события просмотра по пути витрины (без языка): меню филиала, блюдо или обычная страница. */
export function viewEventForPath(path: string, reservedFirstSegments: ReadonlySet<string>): StorefrontEventType {
  const [first, second, , fourth] = path.split('/').filter(Boolean);
  if (first && !reservedFirstSegments.has(first) && second === 'menu') return fourth ? 'dish_view' : 'menu_view';
  return 'page_view';
}
