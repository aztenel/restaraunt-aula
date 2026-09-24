import { Money } from '../../../shared/kernel/money';
import { ratio } from './amounts';

/**
 * Воронка банкетных заявок: new → in_progress → quote_sent → agreed → prepaid → held (+ cancelled).
 * Цели ТЗ: доля заявок с ответом за 30 минут (первый переход из new) и 0 потерянных заявок.
 */
export const BANQUET_SLA_MINUTES = 30;

export const BANQUET_STAGES = ['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held'] as const;
export type BanquetStage = (typeof BANQUET_STAGES)[number];

/** Ранг стадии воронки (0 = new … 5 = held); для cancelled — -1 (не стадия). */
export function banquetStageRank(status: string): number {
  return (BANQUET_STAGES as readonly string[]).indexOf(status);
}

/** Статусы, после которых отмена считается потерей заявки (до согласования сметы). */
const LOST_WHEN_CANCELLED_FROM = new Set(['new', 'in_progress', 'quote_sent']);

export interface BanquetFunnelRow {
  status: string;
  maxStage: number;
  requestedAt: Date;
  firstResponseAt: Date | null;
  cancelledFrom: string | null;
  cancelReason: string | null;
  heldTotal: Money | null;
}

export interface BanquetFunnel {
  total: number;
  stages: Array<{ status: BanquetStage; reached: number; current: number }>;
  held: number;
  heldTotal: Money;
  /** held / total. */
  conversion: number | null;
  /** Заявки, ответ на которые уже должен был быть (ответили или прошло больше SLA). */
  answerDue: number;
  answeredWithinSla: number;
  answeredWithinSlaShare: number | null;
  averageFirstResponseMinutes: number | null;
  medianFirstResponseMinutes: number | null;
  /** Без ответа дольше SLA (статус new). */
  unansweredOverdue: number;
  cancelled: number;
  cancelledBeforeAgreement: number;
  /** Потерянные: отменены до согласования сметы + без ответа дольше SLA. */
  lost: number;
  cancelReasons: Array<{ reason: string; count: number }>;
  slaMinutes: number;
}

export function firstResponseMinutes(row: Pick<BanquetFunnelRow, 'requestedAt' | 'firstResponseAt'>): number | null {
  if (!row.firstResponseAt) return null;
  return Math.max(0, Math.floor((row.firstResponseAt.getTime() - row.requestedAt.getTime()) / 60_000));
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

export function computeBanquetFunnel(rows: readonly BanquetFunnelRow[], now: Date, slaMinutes = BANQUET_SLA_MINUTES): BanquetFunnel {
  const slaMs = slaMinutes * 60_000;
  const stages = BANQUET_STAGES.map((status, rank) => ({
    status,
    reached: rows.filter((r) => r.maxStage >= rank).length,
    current: rows.filter((r) => r.status === status).length,
  }));
  let answerDue = 0;
  let answeredWithinSla = 0;
  let unansweredOverdue = 0;
  const responseMinutes: number[] = [];
  for (const row of rows) {
    const minutes = firstResponseMinutes(row);
    if (minutes !== null) {
      answerDue++;
      responseMinutes.push(minutes);
      if (row.firstResponseAt!.getTime() - row.requestedAt.getTime() <= slaMs) answeredWithinSla++;
    } else if (now.getTime() - row.requestedAt.getTime() > slaMs) {
      answerDue++;
      if (row.status === 'new') unansweredOverdue++;
    }
  }
  const cancelledRows = rows.filter((r) => r.status === 'cancelled');
  const cancelledBeforeAgreement = cancelledRows.filter((r) => LOST_WHEN_CANCELLED_FROM.has(r.cancelledFrom ?? 'new')).length;
  const reasons = new Map<string, number>();
  for (const row of cancelledRows) {
    const reason = row.cancelReason?.trim() || 'not_specified';
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  const heldRows = rows.filter((r) => r.status === 'held');
  const average =
    responseMinutes.length > 0 ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length) : null;
  return {
    total: rows.length,
    stages,
    held: heldRows.length,
    heldTotal: Money.sum(heldRows.map((r) => r.heldTotal ?? Money.zero())),
    conversion: ratio(heldRows.length, rows.length),
    answerDue,
    answeredWithinSla,
    answeredWithinSlaShare: ratio(answeredWithinSla, answerDue),
    averageFirstResponseMinutes: average,
    medianFirstResponseMinutes: median(responseMinutes),
    unansweredOverdue,
    cancelled: cancelledRows.length,
    cancelledBeforeAgreement,
    lost: cancelledBeforeAgreement + unansweredOverdue,
    cancelReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    slaMinutes,
  };
}
