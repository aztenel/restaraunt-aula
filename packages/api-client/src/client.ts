/**
 * Типизированный клиент AULA API поверх openapi-fetch. Пути и типы — из сгенерированной
 * схемы (./schema.d.ts, `pnpm --filter @aula/api-client generate`).
 *
 * Возможности:
 *  - заголовок Authorization: Bearer <token> (getAccessToken);
 *  - язык ответа: Accept-Language и X-Locale (getLocale) — бэкенд отдаёт переводы на этом языке;
 *  - 401 → onUnauthorized (например, обновить access-токен по refresh-cookie) → один повтор запроса;
 *  - raw() — запрос к эндпоинту, которого ещё нет в OpenAPI (модуль в разработке), с тем же конвейером;
 *  - call() — развернуть ответ openapi-fetch в данные или бросить ApiError.
 */
import createClient, { type Client, type Middleware } from 'openapi-fetch';
import { ApiError, toApiError } from './errors';
import type { Locale } from './i18n';
import type { paths } from './schema';

type MaybePromise<T> = T | Promise<T>;

export type ApiPaths = paths;

export interface UnauthorizedContext {
  request: Request;
  response: Response;
}

export interface ApiClientOptions {
  /** Корень API без /api/v1: 'https://aula.kz', 'http://localhost:3000' или '' (тот же origin). */
  baseUrl: string;
  /** Текущий access-токен сотрудника (админка). */
  getAccessToken?: () => MaybePromise<string | null | undefined>;
  /** Язык ответа (переводимые поля витрины). */
  getLocale?: () => Locale | string | null | undefined;
  /**
   * Вызывается при 401 на обычном запросе. Вернуть true — запрос будет повторён один раз
   * (токен перечитывается через getAccessToken). Эндпоинты входа/обновления сессии не повторяются.
   */
  onUnauthorized?: (context: UnauthorizedContext) => MaybePromise<boolean | void>;
  /** Своя реализация fetch (Next.js: кэш и revalidate; тесты: заглушка). */
  fetch?: (request: Request) => Promise<Response>;
  /** Постоянные заголовки. */
  headers?: Record<string, string>;
  /** credentials для fetch. По умолчанию 'include' (refresh-cookie админки). */
  credentials?: RequestCredentials;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RawRequestInit {
  query?: Record<string, string | number | boolean | null | undefined | Array<string | number>>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface ApiClient extends Client<paths> {
  /**
   * Запрос к эндпоинту, которого пока нет в docs/openapi.json. Возвращает разобранный JSON
   * (undefined для 204), бросает ApiError. После появления эндпоинта в схеме — перейти на
   * типизированные GET/POST.
   */
  raw<T = unknown>(method: HttpMethod, path: string, init?: RawRequestInit): Promise<T>;
  /** Итоговый корень API (для EventSource и ссылок на файлы). */
  readonly baseUrl: string;
}

const NO_RETRY_PATHS = ['/admin/auth/login', '/admin/auth/refresh', '/admin/auth/logout'];

function shouldSkipRetry(url: string): boolean {
  return NO_RETRY_PATHS.some((p) => url.includes(p));
}

export function buildQueryString(query: RawRequestInit['query']): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, String(v)));
    else params.append(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const baseFetch = options.fetch ?? ((request: Request) => globalThis.fetch(request));
  const credentials = options.credentials ?? 'include';

  async function applyHeaders(request: Request): Promise<Request> {
    if (options.getAccessToken && !request.headers.has('Authorization')) {
      const token = await options.getAccessToken();
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
    }
    const locale = options.getLocale?.();
    if (locale) {
      request.headers.set('Accept-Language', locale);
      request.headers.set('X-Locale', locale);
    }
    return request;
  }

  async function fetchWithAuthRetry(request: Request): Promise<Response> {
    const canRetry = Boolean(options.onUnauthorized) && !shouldSkipRetry(request.url);
    // Копия до отправки: тело исходного запроса будет прочитано fetch.
    const retryCopy = canRetry ? request.clone() : null;
    const response = await baseFetch(request);
    if (response.status !== 401 || !retryCopy || !options.onUnauthorized) return response;
    const retry = await options.onUnauthorized({ request, response });
    if (!retry) return response;
    retryCopy.headers.delete('Authorization');
    const token = await options.getAccessToken?.();
    if (token) retryCopy.headers.set('Authorization', `Bearer ${token}`);
    return baseFetch(retryCopy);
  }

  const middleware: Middleware = {
    onRequest: ({ request }) => applyHeaders(request),
  };

  const client = createClient<paths>({
    baseUrl,
    fetch: fetchWithAuthRetry,
    credentials,
    headers: { Accept: 'application/json', ...options.headers },
  });
  client.use(middleware);

  async function raw<T>(method: HttpMethod, path: string, init: RawRequestInit = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json', ...options.headers, ...init.headers });
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(init.body);
    }
    const request = await applyHeaders(
      new Request(`${baseUrl}${path}${buildQueryString(init.query)}`, {
        method,
        headers,
        body,
        credentials,
        signal: init.signal,
      }),
    );
    let response: Response;
    try {
      response = await fetchWithAuthRetry(request);
    } catch (error) {
      throw toApiError(error);
    }
    const payload = await readBody(response);
    if (!response.ok) {
      throw ApiError.fromResponse(response.status, payload, response.headers.get('x-request-id'));
    }
    return payload as T;
  }

  return Object.assign(client, { raw, baseUrl });
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

interface OpenApiResult<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

/**
 * Развернуть результат openapi-fetch: данные при 2xx, иначе ApiError (включая сетевые сбои).
 *   const me = await call(api.GET('/api/v1/admin/auth/me'));
 */
export async function call<T>(promise: Promise<OpenApiResult<T>>): Promise<T> {
  let result: OpenApiResult<T>;
  try {
    result = await promise;
  } catch (error) {
    throw toApiError(error);
  }
  if (!result.response.ok) {
    throw ApiError.fromResponse(result.response.status, result.error, result.response.headers.get('x-request-id'));
  }
  return result.data as T;
}
