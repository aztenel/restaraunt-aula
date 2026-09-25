import { Injectable } from '@nestjs/common';
import { IntegrationLog } from './integration-log';

/**
 * Ошибка внешней системы. retryable=true — задача будет повторена с экспоненциальной задержкой
 * (сетевые ошибки, 5xx, 429). retryable=false — повтор бессмыслен (4xx, неверные данные).
 */
export class ExternalServiceError extends Error {
  constructor(
    readonly integration: string,
    message: string,
    readonly retryable: boolean,
    readonly statusCode: number | null = null,
    readonly responseBody: unknown = null,
  ) {
    super(`[${integration}] ${message}`);
    this.name = 'ExternalServiceError';
  }
}

export interface ExternalRequest {
  integration: string;
  operation: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** Объект -> JSON; строка/URLSearchParams — как есть. */
  body?: unknown;
  timeoutMs?: number;
  correlationId?: string | null;
  /**
   * Что записать в журнал вместо тела запроса, если тело содержит секреты, которые не распознаёт
   * общее маскирование (например, ключ ЭЦП в массиве подписантов).
   */
  logBody?: unknown;
}

export interface ExternalResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
  rawText: string;
}

/** Абстракция над fetch, чтобы адаптеры тестировались без сети. */
export abstract class HttpTransport {
  abstract send(input: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }): Promise<{
    status: number;
    headers: Record<string, string>;
    text: string;
  }>;
}

export class FetchTransport extends HttpTransport {
  async send(input: { method: string; url: string; headers: Record<string, string>; body?: string; timeoutMs: number }) {
    const res = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    return { status: res.status, headers, text: await res.text() };
  }
}

/**
 * HTTP-клиент для адаптеров интеграций: таймауты, классификация ошибок,
 * полный лог запроса и ответа (с маскированием) в platform.integration_logs.
 */
@Injectable()
export class ExternalHttp {
  constructor(
    private readonly transport: HttpTransport,
    private readonly log: IntegrationLog,
  ) {}

  async request<T = unknown>(req: ExternalRequest): Promise<ExternalResponse<T>> {
    const headers: Record<string, string> = { accept: 'application/json', ...(req.headers ?? {}) };
    let body: string | undefined;
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body instanceof URLSearchParams) {
        body = req.body.toString();
        headers['content-type'] ??= 'application/x-www-form-urlencoded';
      } else {
        body = JSON.stringify(req.body);
        headers['content-type'] ??= 'application/json';
      }
    }
    const loggedBody =
      req.logBody !== undefined ? req.logBody : req.body instanceof URLSearchParams ? Object.fromEntries(req.body) : (req.body ?? null);
    const started = Date.now();
    let status: number | null = null;
    let rawText = '';
    try {
      const res = await this.transport.send({ method: req.method, url: req.url, headers, body, timeoutMs: req.timeoutMs ?? 15_000 });
      status = res.status;
      rawText = res.text;
      let parsed: unknown = rawText;
      if (rawText && (res.headers['content-type'] ?? '').includes('json')) {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = rawText;
        }
      }
      const success = res.status >= 200 && res.status < 300;
      await this.log.record({
        integration: req.integration,
        direction: 'outbound',
        operation: req.operation,
        correlationId: req.correlationId ?? null,
        request: { method: req.method, url: req.url, headers, body: loggedBody },
        response: { status: res.status, headers: res.headers, body: parsed },
        statusCode: res.status,
        success,
        durationMs: Date.now() - started,
        error: success ? null : `HTTP ${res.status}`,
      });
      if (!success) {
        const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
        throw new ExternalServiceError(req.integration, `${req.operation} failed with HTTP ${res.status}`, retryable, res.status, parsed);
      }
      return { status: res.status, headers: res.headers, body: parsed as T, rawText };
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await this.log.record({
        integration: req.integration,
        direction: 'outbound',
        operation: req.operation,
        correlationId: req.correlationId ?? null,
        request: { method: req.method, url: req.url, headers, body: loggedBody },
        response: null,
        statusCode: status,
        success: false,
        durationMs: Date.now() - started,
        error: message,
      });
      throw new ExternalServiceError(req.integration, `${req.operation} network error: ${message}`, true, status);
    }
  }
}
