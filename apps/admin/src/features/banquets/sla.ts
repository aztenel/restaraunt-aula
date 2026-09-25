/**
 * SLA первого ответа по банкетной заявке (ТЗ: 95% заявок с ответом за 30 минут, ноль потерянных).
 * Срок (slaDeadline) и факт нарушения (slaBreached) считает сервер; здесь — только обратный отсчёт
 * для карточки «новой» заявки и подписи для отображения. Чистые функции — тестируются без браузера.
 */
export const SLA_MINUTES = 30;
/** За сколько минут до срока карточка становится «жёлтой». */
export const SLA_WARNING_MINUTES = 10;

export type SlaState = 'running' | 'warning' | 'breached';

export interface SlaCountdown {
  state: SlaState;
  /** running/warning — секунд до срока; breached — секунд после срока (0, если сервер уже отметил нарушение раньше). */
  seconds: number;
  /** 'm:ss' или 'h:mm:ss'. */
  text: string;
}

export interface SlaSubject {
  status: string;
  slaDeadline: string;
  slaBreached: boolean;
  firstResponseAt: string | null;
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
 * Отсчёт до срока первого ответа. Только для заявки в статусе «новая» без ответа менеджера;
 * иначе null (таймер не показывается). Нарушение — по флагу сервера или когда срок прошёл по часам.
 */
export function slaCountdown(subject: SlaSubject, nowMs: number, warningMinutes = SLA_WARNING_MINUTES): SlaCountdown | null {
  if (subject.status !== 'new' || subject.firstResponseAt) return null;
  const deadline = Date.parse(subject.slaDeadline);
  if (!Number.isFinite(deadline)) return null;
  const diff = deadline - nowMs;
  if (diff <= 0 || subject.slaBreached) {
    const overdue = Math.max(0, Math.floor(-diff / 1000));
    return { state: 'breached', seconds: overdue, text: formatDuration(overdue) };
  }
  const seconds = Math.ceil(diff / 1000);
  return { state: seconds <= warningMinutes * 60 ? 'warning' : 'running', seconds, text: formatDuration(seconds) };
}

/** Через сколько минут был первый ответ и уложился ли он в срок (для карточки заявки). */
export function firstResponseInfo(subject: SlaSubject & { createdAt: string }): { minutes: number; withinSla: boolean } | null {
  if (!subject.firstResponseAt) return null;
  const created = Date.parse(subject.createdAt);
  const answered = Date.parse(subject.firstResponseAt);
  const deadline = Date.parse(subject.slaDeadline);
  if (!Number.isFinite(created) || !Number.isFinite(answered)) return null;
  return {
    minutes: Math.max(0, Math.floor((answered - created) / 60_000)),
    withinSla: Number.isFinite(deadline) ? answered <= deadline : !subject.slaBreached,
  };
}

/** Базисные пункты → проценты строкой без лишних нулей: 9550 → «95,5», 10000 → «100». */
export function bpToPercentText(bp: number | null | undefined, locale = 'ru'): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '—';
  const value = Math.trunc(bp);
  const negative = value < 0;
  const abs = Math.abs(value);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const separator = locale.startsWith('en') ? '.' : ',';
  const fraction = minor === 0 ? '' : `${separator}${String(minor).padStart(2, '0').replace(/0$/, '')}`;
  return `${negative ? '-' : ''}${major}${fraction}`;
}

export type SlaTone = 'success' | 'warning' | 'danger' | 'none';

/** Цвет доли ответов в срок относительно цели: цель достигнута / близко (−5 п.п.) / ниже. */
export function slaShareTone(shareBp: number | null, targetBp: number): SlaTone {
  if (shareBp === null) return 'none';
  if (shareBp >= targetBp) return 'success';
  if (shareBp >= targetBp - 500) return 'warning';
  return 'danger';
}
