/**
 * Клиенты AULA API для витрины.
 *  - createServerApi — серверный рендеринг: внутренний адрес API, кэш данных Next.js
 *    (revalidate 60 с для меню/контента), таймаут, язык ответа.
 *  - getBrowserApi — запросы из браузера (корзина, оформление, статусы): NEXT_PUBLIC_API_URL
 *    или тот же origin.
 * Бизнес-расчётов на витрине нет: суммы, доступность, статусы приходят с сервера.
 */
import { createApiClient, type ApiClient } from '@aula/api-client';
import { CONTENT_REVALIDATE_SECONDS, getBrowserApiUrl, getServerApiUrl } from './config';

const SERVER_TIMEOUT_MS = 8000;

export interface ServerApiOptions {
  locale?: string;
  /** Секунд кэша данных; false — без кэша (статусы заказов, токены). */
  revalidate?: number | false;
  /** Теги кэша для точечного сброса (revalidateTag). */
  tags?: string[];
}

export function createServerApi(options: ServerApiOptions = {}): ApiClient {
  const revalidate = options.revalidate ?? CONTENT_REVALIDATE_SECONDS;
  return createApiClient({
    baseUrl: getServerApiUrl(),
    getLocale: () => options.locale,
    credentials: 'omit',
    fetch: (request) =>
      fetch(request, {
        signal: AbortSignal.timeout(SERVER_TIMEOUT_MS),
        ...(revalidate === false
          ? { cache: 'no-store' as const }
          : { next: { revalidate, tags: options.tags } }),
      }),
  });
}

const browserClients = new Map<string, ApiClient>();

/** Клиент для браузера (один на язык). */
export function getBrowserApi(locale: string): ApiClient {
  let client = browserClients.get(locale);
  if (!client) {
    client = createApiClient({
      baseUrl: getBrowserApiUrl(),
      getLocale: () => locale,
      credentials: 'same-origin',
    });
    browserClients.set(locale, client);
  }
  return client;
}
