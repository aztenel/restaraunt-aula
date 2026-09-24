import { ExternalServiceError } from '../../../shared/infrastructure/integrations/external-http';
import { DomainError, NotFoundError } from '../../../shared/kernel/errors';
import { POS_NOT_CONFIGURED } from '../domain/pos-client';
import { PosFailureReason } from '../public';
import { UNKNOWN_PROVIDER } from './pos-client.registry';

export interface ClassifiedPosError {
  /** Повтор имеет смысл (сеть, 5xx, 429, таймаут, неизвестный сбой). */
  retryable: boolean;
  /** Причина окончательной неудачи, если повтор бессмыслен. */
  reason: PosFailureReason;
  message: string;
}

const NOT_CONFIGURED_CODES = new Set([POS_NOT_CONFIGURED, UNKNOWN_PROVIDER, 'integration.misconfigured']);

/**
 * Классификация ошибок при работе с POS:
 * - ExternalServiceError — по флагу retryable адаптера (HTTP-статус, сеть);
 * - доменные ошибки настройки — «не настроено» (повтор не поможет, нужна настройка);
 * - прочие доменные ошибки — отказ (данные неверны);
 * - неизвестные сбои — временные (повтор с задержкой).
 */
export function classifyPosError(err: unknown): ClassifiedPosError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof ExternalServiceError) {
    return { retryable: err.retryable, reason: err.retryable ? 'retries_exhausted' : 'rejected', message };
  }
  if (err instanceof DomainError) {
    if (NOT_CONFIGURED_CODES.has(err.code)) return { retryable: false, reason: 'not_configured', message: `${err.code}: ${message}` };
    if (err instanceof NotFoundError) return { retryable: false, reason: 'order_unavailable', message: `${err.code}: ${message}` };
    return { retryable: false, reason: 'rejected', message: `${err.code}: ${message}` };
  }
  return { retryable: true, reason: 'retries_exhausted', message };
}
