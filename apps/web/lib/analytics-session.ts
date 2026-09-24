/**
 * Идентификатор сессии витрины (uuid в localStorage) — для конверсии «сессии витрины → заказы»
 * в отчётах. Передаётся в заказ (analyticsSessionId) и в события витрины.
 *
 * TODO(reporting): отправлять события витрины в POST /api/v1/public/analytics/events
 * ({ sessionId, type: 'session_start' | 'view_menu' | 'add_to_cart' | ..., branchId, occurredAt })
 * — эндпоинт появится в модуле Reporting.
 */
export const ANALYTICS_SESSION_KEY = 'aula_asid';

function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Запасной вариант для старых браузеров (RFC 4122 v4).
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
