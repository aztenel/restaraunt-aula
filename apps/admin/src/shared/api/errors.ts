/**
 * Человекочитаемое сообщение об ошибке API: таблица известных кодов (ru/kk) → текст,
 * общие суффиксы (*.not_found, *.invalid_transition), иначе message сервера.
 */
import { ApiError, toApiError } from '@aula/api-client';
import { ERROR_MESSAGES, type ErrorLanguage } from './error-messages';

function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '');
}

function formatUntil(iso: unknown, language: ErrorLanguage): string {
  if (typeof iso !== 'string') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(language === 'kk' ? 'kk-KZ' : 'ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Almaty',
  }).format(date);
}

export function resolveErrorLanguage(language: string | undefined): ErrorLanguage {
  return language?.startsWith('kk') ? 'kk' : 'ru';
}

/** Текст ошибки для пользователя. */
export function errorMessage(error: unknown, language?: string): string {
  const lang = resolveErrorLanguage(language);
  const table = ERROR_MESSAGES[lang];
  const apiError: ApiError = toApiError(error);
  const values = {
    until: formatUntil(apiError.details.lockedUntil, lang),
    seconds: String(apiError.retryAfterSeconds ?? apiError.details.retryAfterSeconds ?? ''),
  };
  const known = table[apiError.code];
  if (known) return interpolate(known, values);
  if (apiError.code.endsWith('.not_found')) return table['suffix.not_found']!;
  if (apiError.code.endsWith('.invalid_transition')) return table['suffix.invalid_transition']!;
  if (apiError.status === 404 && apiError.code.startsWith('http.')) return table['http.404']!;
  if (apiError.status >= 500 && apiError.code.startsWith('http.')) return table['http.5xx']!;
  if (apiError.message && apiError.message !== apiError.code) return apiError.message;
  return table.unknown!;
}

/** Ошибки полей валидации (400 request.invalid → details.fields). */
export function errorFieldMessages(error: unknown): string[] {
  return toApiError(error).fieldMessages;
}

/** Текст по известному коду ошибки (клиентская проверка тем же правилом, что на сервере). */
export function messageForCode(code: string, language?: string): string {
  return errorMessage(new ApiError({ status: 422, code }), language);
}
