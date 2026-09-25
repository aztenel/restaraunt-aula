/**
 * Маскирование чувствительных данных в логах интеграций: номера карт, CVV, токены, пароли, подписи.
 * Ответы внешних систем логируются целиком, но через эту функцию.
 */
const SENSITIVE_KEY_RE =
  /(pan|card_?number|cardnumber|cvv|cvc|cvv2|expiry|exp_?date|password|passwd|secret|token|authorization|api[_-]?key|signature|private[_-]?key|client_secret|access_token|refresh_token|api[_-]?login|login_?password|psw)/i;
const PAN_RE = /\b(\d{6})\d{3,9}(\d{4})\b/g;

export function maskString(value: string): string {
  return value.replace(PAN_RE, (_m, first: string, last: string) => `${first}******${last}`);
}

export function maskSensitive<T>(value: T, depth = 0): T {
  if (depth > 12) return '[depth]' as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return maskString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => maskSensitive(v, depth + 1)) as unknown as T;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return `[buffer ${value.length} bytes]` as unknown as T;
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = typeof v === 'string' && v.length > 4 ? `***${v.slice(-4)}` : '***';
      } else {
        out[k] = maskSensitive(v, depth + 1);
      }
    }
    return out as T;
  }
  return value;
}
