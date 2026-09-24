import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { Database } from '../../../shared/infrastructure/database/database';
import { ExternalHttp, HttpTransport } from '../../../shared/infrastructure/integrations/external-http';
import { IntegrationLog, IntegrationLogEntry } from '../../../shared/infrastructure/integrations/integration-log';

/**
 * Маскирование в журнале интеграций сверх общего (платформа маскирует по именам полей):
 * - секреты в URL и теле формы (ключ API в строке запроса, пароль шлюза, токен бота в пути URL);
 * - значения чувствительных параметров сообщения (коды подтверждения и сертификатов), которые
 *   провайдер получает в тексте: задача доставки выполняет отправку внутри SecretRedaction.run(...).
 */
const redactionStore = new AsyncLocalStorage<readonly string[]>();

export const SecretRedaction = {
  run<T>(secrets: readonly string[], fn: () => Promise<T>): Promise<T> {
    return redactionStore.run(
      secrets.filter((s) => typeof s === 'string' && s.length >= 4),
      fn,
    );
  },
  current(): readonly string[] {
    return redactionStore.getStore() ?? [];
  },
};

const URL_SECRET_RE = /((?:^|[?&])(?:apikey|api_key|psw|password|passwd|token|access_token|secret)=)[^&#\s"]*/gi;
const BOT_TOKEN_RE = /\/bot\d+:[A-Za-z0-9_-]+/g;

export function redactText(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(BOT_TOKEN_RE, '/bot***').replace(URL_SECRET_RE, '$1***');
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

export function redactDeep<T>(value: T, secrets: readonly string[] = [], depth = 0): T {
  if (depth > 12 || value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value, secrets) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, secrets, depth + 1)) as unknown as T;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value instanceof URLSearchParams) return redactText(value.toString(), secrets) as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, secrets, depth + 1);
    return out as T;
  }
  return value;
}

/** Журнал интеграций модуля: дополнительно маскирует секреты в URL, теле и тексте сообщений. */
@Injectable()
export class RedactingIntegrationLog extends IntegrationLog {
  constructor(database: Database, clock: Clock) {
    super(database, clock);
  }

  override async record(entry: IntegrationLogEntry): Promise<void> {
    const secrets = SecretRedaction.current();
    await super.record({
      ...entry,
      request: redactDeep(entry.request ?? null, secrets),
      response: redactDeep(entry.response ?? null, secrets),
      error: entry.error ? redactText(entry.error, secrets) : entry.error,
    });
  }
}

/** HTTP-клиент адаптеров уведомлений: ExternalHttp платформы с маскирующим журналом. */
export const NOTIFICATIONS_HTTP = Symbol('NOTIFICATIONS_HTTP');

export function createNotificationsHttp(transport: HttpTransport, log: RedactingIntegrationLog): ExternalHttp {
  return new ExternalHttp(transport, log);
}
