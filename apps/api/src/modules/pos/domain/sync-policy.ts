/**
 * Политика периодической синхронизации стоп-листа с POS.
 *
 * Опрос каждые 5 минут. Если POS недоступна — повторы с экспоненциально растущим промежутком
 * (5, 10, 20, 40, 60 минут), чтобы не нагружать упавшую систему и не засорять очередь неудач.
 * Персонал оповещается один раз на эпизод: после STOP_LIST_ALERT_AFTER_FAILURES неудач подряд
 * или сразу, если ошибка не временная (не настроено, POS отклонила запрос).
 */
export const STOP_LIST_SYNC_INTERVAL_MS = 300_000;
export const STOP_LIST_MAX_RETRY_DELAY_MS = 60 * 60_000;
export const STOP_LIST_ALERT_AFTER_FAILURES = 3;
/** Если поставленная задача не выполнилась за это время — считаем её потерянной и ставим снова. */
export const STOP_LIST_ENQUEUE_STALE_MS = 15 * 60_000;

export interface StopListSyncState {
  enqueuedAt: Date | null;
  attemptedAt: Date | null;
  failures: number;
}

/** Задача синхронизации уже в очереди и ещё не начала выполняться. */
export function isSyncQueued(state: StopListSyncState, now: Date): boolean {
  if (!state.enqueuedAt) return false;
  const notStartedYet = !state.attemptedAt || state.attemptedAt.getTime() < state.enqueuedAt.getTime();
  return notStartedYet && now.getTime() - state.enqueuedAt.getTime() < STOP_LIST_ENQUEUE_STALE_MS;
}

/**
 * Промежуток между попытками после неудач: 1 неудача — обычный интервал (5 мин), 2 — 10 мин, 3 — 20 мин,
 * 4 — 40 мин, дальше — час.
 */
export function retryGapMs(failures: number, intervalMs: number = STOP_LIST_SYNC_INTERVAL_MS): number {
  if (failures <= 0) return 0;
  return Math.min(intervalMs * 2 ** (failures - 1), STOP_LIST_MAX_RETRY_DELAY_MS);
}

/**
 * Ставить ли синхронизацию по расписанию. Допуск в половину интервала: задача выполняется чуть позже
 * тика расписания, и без допуска очередной тик «не дотягивал» бы до срока.
 */
export function shouldScheduleSync(state: StopListSyncState, now: Date, intervalMs: number = STOP_LIST_SYNC_INTERVAL_MS): boolean {
  if (isSyncQueued(state, now)) return false;
  if (state.failures > 0 && state.attemptedAt) {
    return now.getTime() >= state.attemptedAt.getTime() + retryGapMs(state.failures, intervalMs) - intervalMs / 2;
  }
  return true;
}

/** Оповещать ли персонал о проблеме синхронизации (один раз на эпизод). */
export function shouldAlertSyncFailure(input: { failures: number; retryable: boolean; alreadyAlerted: boolean }): boolean {
  if (input.alreadyAlerted) return false;
  return !input.retryable || input.failures >= STOP_LIST_ALERT_AFTER_FAILURES;
}
