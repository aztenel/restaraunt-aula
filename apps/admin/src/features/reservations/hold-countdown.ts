/**
 * Обратный отсчёт до снятия неподтверждённой / неоплаченной брони (holdExpiresAt от сервера).
 * Бронь снимает сервер (статус expired); отсчёт — только подсказка оператору, сколько осталось.
 */
export type HoldUrgency = 'ok' | 'warning' | 'critical' | 'expired';

export interface HoldCountdown {
  /** Секунд до снятия (0 — время вышло). */
  seconds: number;
  /** 'm:ss' или 'h:mm:ss'. */
  text: string;
  urgency: HoldUrgency;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/**
 * Сколько осталось до holdExpiresAt. critical — меньше 5 минут, warning — меньше 15 минут
 * (пороги настраиваются). null — у брони нет удержания.
 */
export function holdCountdown(
  holdExpiresAt: string | null | undefined,
  now: number,
  thresholds: { warningMinutes: number; criticalMinutes: number } = { warningMinutes: 15, criticalMinutes: 5 },
): HoldCountdown | null {
  if (!holdExpiresAt) return null;
  const expires = new Date(holdExpiresAt).getTime();
  if (Number.isNaN(expires)) return null;
  const seconds = Math.max(0, Math.ceil((expires - now) / 1000));
  let urgency: HoldUrgency = 'ok';
  if (seconds === 0) urgency = 'expired';
  else if (seconds <= thresholds.criticalMinutes * 60) urgency = 'critical';
  else if (seconds <= thresholds.warningMinutes * 60) urgency = 'warning';
  return { seconds, text: formatDuration(seconds), urgency };
}

/** Порядок очереди: сначала те, у кого удержание истекает раньше; без удержания — в конце, по началу брони. */
export function byHoldExpiry<T extends { holdExpiresAt: string | null; start: string }>(a: T, b: T): number {
  const ha = a.holdExpiresAt ? new Date(a.holdExpiresAt).getTime() : Number.POSITIVE_INFINITY;
  const hb = b.holdExpiresAt ? new Date(b.holdExpiresAt).getTime() : Number.POSITIVE_INFINITY;
  if (ha !== hb) return ha - hb;
  return new Date(a.start).getTime() - new Date(b.start).getTime();
}
