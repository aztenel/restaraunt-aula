/**
 * Тексты ошибок API по машинному коду (ТЗ: «тексты по коду — словари i18n»).
 * Код 'certificate.not_found' → ключ 'certificate_not_found' пространства имён ApiErrors;
 * неизвестный код → общий текст по статусу (сеть, лимит частоты, неверный запрос).
 */
import type { ApiError } from '@aula/api-client';
import type messages from '@/messages/ru.json';

export type ApiErrorKey = keyof (typeof messages)['ApiErrors'];
export type OrderProblemKey = keyof (typeof messages)['OrderProblems'];

/** Код API → ключ словаря (точки недопустимы в ключах next-intl). */
export function codeToKey(code: string): string {
  return code.replace(/[^a-zA-Z0-9]+/g, '_');
}

/**
 * Ключ текста ошибки. has — проверка наличия ключа в словаре (t.has), чтобы не отправлять
 * весь словарь в браузер ради списка известных кодов.
 */
export function apiErrorKey(error: ApiError, has: (key: ApiErrorKey) => boolean): ApiErrorKey {
  const key = codeToKey(error.code) as ApiErrorKey;
  if (error.code && has(key) && key !== 'retryIn') return key;
  if (error.isNetworkError) return 'network_error';
  if (error.isRateLimited) return 'rate_limit_exceeded';
  if (error.status === 400) return 'request_invalid';
  return 'generic';
}

/** Через сколько минут можно повторить (429), округление вверх; null — сервер не сообщил. */
export function retryAfterMinutes(error: ApiError): number | null {
  const seconds = error.retryAfterSeconds;
  if (seconds === null || seconds <= 0) return null;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** Ключ текста проблемы позиции/заказа из расчёта корзины. */
export function problemKey(code: string | null | undefined, has: (key: OrderProblemKey) => boolean): OrderProblemKey {
  if (!code) return 'generic';
  const key = codeToKey(code) as OrderProblemKey;
  return has(key) ? key : 'generic';
}
