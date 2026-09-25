import { BanquetStatus } from '../public';

/**
 * SLA первого ответа по банкетной заявке (цель ТЗ: 95% заявок с ответом за 30 минут, ноль потерянных).
 * Первый ответ — первое действие менеджера: взятие в работу или отметка контакта с гостем.
 */
export const SLA_FIRST_RESPONSE_MINUTES = 30;

export interface SlaSubject {
  status: BanquetStatus;
  createdAt: Date;
  firstResponseAt: Date | null;
}

export function slaDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SLA_FIRST_RESPONSE_MINUTES * 60_000);
}

/** Заявка всё ещё новая, ответа нет, и 30 минут прошли. */
export function isSlaBreached(subject: SlaSubject, now: Date): boolean {
  return subject.status === 'new' && subject.firstResponseAt === null && now.getTime() >= slaDeadline(subject.createdAt).getTime();
}

export function minutesSince(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
}

/** Ответ был дан в срок. */
export function answeredWithinSla(subject: Pick<SlaSubject, 'createdAt' | 'firstResponseAt'>): boolean {
  return subject.firstResponseAt !== null && subject.firstResponseAt.getTime() <= slaDeadline(subject.createdAt).getTime();
}

export interface SlaStats {
  total: number;
  /** С ответом менеджера. */
  answered: number;
  answeredWithinSla: number;
  /** Доля заявок с ответом за 30 минут, в базисных пунктах (9500 = 95%). null — заявок нет. */
  withinSlaShareBp: number | null;
  /** Нарушения: ответ позже срока или нет ответа после срока. */
  breached: number;
  /** Без ответа сейчас (новые или отменённые без контакта) — кандидаты в «потерянные». */
  unanswered: number;
  /** Отменены без единого ответа менеджера — потерянные заявки. */
  lost: number;
  /** Среднее время первого ответа, минут (по заявкам с ответом). */
  averageFirstResponseMinutes: number | null;
}

/** Статистика SLA за период (по заявкам, созданным в периоде). */
export function slaStats(rows: readonly SlaSubject[], now: Date): SlaStats {
  let answered = 0;
  let within = 0;
  let breached = 0;
  let unanswered = 0;
  let lost = 0;
  let responseMinutesTotal = 0;
  for (const r of rows) {
    if (r.firstResponseAt) {
      answered += 1;
      responseMinutesTotal += minutesSince(r.createdAt, r.firstResponseAt);
      if (answeredWithinSla(r)) within += 1;
      else breached += 1;
    } else {
      unanswered += 1;
      if (r.status === 'cancelled') lost += 1;
      if (now.getTime() >= slaDeadline(r.createdAt).getTime()) breached += 1;
    }
  }
  const total = rows.length;
  return {
    total,
    answered,
    answeredWithinSla: within,
    withinSlaShareBp: total === 0 ? null : Math.floor((within * 10_000) / total),
    breached,
    unanswered,
    lost,
    averageFirstResponseMinutes: answered === 0 ? null : Math.round(responseMinutesTotal / answered),
  };
}
