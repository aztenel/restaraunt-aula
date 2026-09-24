/**
 * Защита от подбора кодов сертификатов (decisions.md): лимит проверок на IP + глобальный счётчик
 * неудачных проверок. После 20 неудач с одного IP за час — блокировка IP на час.
 * Глобальный всплеск неудач (подбор с множества IP) — оповещение персоналу.
 */
export const CERTIFICATE_CHECK_POLICY = {
  maxFailuresPerIp: 20,
  windowMs: 60 * 60_000,
  blockMs: 60 * 60_000,
  /** Неудачных проверок со всех IP за окно, после которых оповещаем администратора. */
  globalAlertThreshold: 200,
  /** Сколько хранить журнал неудач. */
  retentionMs: 7 * 24 * 60 * 60_000,
} as const;

/** Нужно ли блокировать IP после очередной неудачи (с учётом её самой). */
export function shouldBlockIp(failuresInWindow: number): boolean {
  return failuresInWindow >= CERTIFICATE_CHECK_POLICY.maxFailuresPerIp;
}

/**
 * Глобальный всплеск неудач (подбор с множества IP). Проверяется периодической задачей,
 * оповещение дедуплицируется по часу.
 */
export function shouldAlertGlobal(globalFailuresInWindow: number): boolean {
  return globalFailuresInWindow >= CERTIFICATE_CHECK_POLICY.globalAlertThreshold;
}

export function blockedUntil(now: Date): Date {
  return new Date(now.getTime() + CERTIFICATE_CHECK_POLICY.blockMs);
}

export function windowStart(now: Date): Date {
  return new Date(now.getTime() - CERTIFICATE_CHECK_POLICY.windowMs);
}

export function retryAfterSeconds(until: Date, now: Date): number {
  return Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000));
}
