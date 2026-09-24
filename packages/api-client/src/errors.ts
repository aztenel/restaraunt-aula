/**
 * Ошибки API. Бэкенд отдаёт единый формат:
 *   { error: { code, message, details }, requestId }
 * где code — машинный код вида '<entity>.<reason>' ('auth.locked', 'user.email_taken').
 * Фронтенды показывают пользователю текст по коду (таблица переводов), а message — как запасной вариант.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: ApiErrorPayload;
  requestId: string | null;
}

/** Код для сетевых сбоев (API недоступен, CORS, обрыв соединения). */
export const NETWORK_ERROR_CODE = 'network.error';
/** Код для ответов, не соответствующих формату ошибок API (например, HTML от прокси). */
export const UNKNOWN_ERROR_CODE = 'http.unknown';

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (!value || typeof value !== 'object') return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && (message === undefined || typeof message === 'string');
}

export class ApiError extends Error {
  /** HTTP-статус; 0 — сетевая ошибка (ответа не было). */
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message?: string;
    details?: Record<string, unknown>;
    requestId?: string | null;
    cause?: unknown;
  }) {
    super(init.message || init.code, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? {};
    this.requestId = init.requestId ?? null;
  }

  /**
   * Построить ошибку из статуса и тела ответа. Тело может быть в формате API,
   * строкой (прокси, HTML-страница) или отсутствовать.
   */
  static fromResponse(status: number, body: unknown, requestIdHeader?: string | null): ApiError {
    if (isApiErrorBody(body)) {
      return new ApiError({
        status,
        code: body.error.code,
        message: body.error.message,
        details: body.error.details,
        requestId: body.requestId ?? requestIdHeader ?? null,
      });
    }
    return new ApiError({
      status,
      code: status > 0 ? `http.${status}` : UNKNOWN_ERROR_CODE,
      message: typeof body === 'string' && body.length > 0 && body.length < 300 ? body : `HTTP ${status}`,
      requestId: requestIdHeader ?? null,
    });
  }

  static network(cause: unknown): ApiError {
    const message = cause instanceof Error ? cause.message : 'Network error';
    return new ApiError({ status: 0, code: NETWORK_ERROR_CODE, message, cause });
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  /** 400 (неверный запрос) и 422 (нарушено бизнес-правило). */
  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  /** Через сколько секунд можно повторить (для 429). */
  get retryAfterSeconds(): number | null {
    const value = this.details.retryAfterSeconds;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  /** Список сообщений валидации полей (для 400 request.invalid). */
  get fieldMessages(): string[] {
    const fields = this.details.fields;
    return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : [];
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Привести любую ошибку к ApiError (для единообразной обработки в UI). */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
    return ApiError.network(error);
  }
  return new ApiError({
    status: 0,
    code: UNKNOWN_ERROR_CODE,
    message: error instanceof Error ? error.message : String(error),
    cause: error,
  });
}
