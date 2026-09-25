/**
 * Кнопки действий над бронью — только из того, что разрешил сервер (allowedTransitions, canReschedule).
 * Фронт не знает автомата статусов и правил времени («пришли» — не раньше чем за 3 часа, «не пришли» —
 * только после начала): он лишь сопоставляет разрешённый переход с кнопкой. Банкетной занятостью
 * управляет модуль банкетов — у неё кнопок нет.
 */
import type {
  CancelReservationInput,
  DepositDecision,
  DepositOutcome,
  DepositState,
  ReservationKind,
  ReservationStatus,
} from './types';

export type ReservationActionKey = 'confirm' | 'confirmWaive' | 'arrived' | 'noShow' | 'reschedule' | 'cancel';

export interface ReservationAction {
  key: ReservationActionKey;
  /** primary — главная кнопка, danger — отмена. */
  emphasis: 'primary' | 'default' | 'danger';
  /** Нужен диалог (причина, решение по депозиту, новое время). */
  needsDialog: boolean;
}

export interface ActionSource {
  kind: ReservationKind;
  status: ReservationStatus;
  allowedTransitions: readonly string[];
  canReschedule: boolean;
}

const ORDER: ReservationActionKey[] = ['confirm', 'confirmWaive', 'arrived', 'noShow', 'reschedule', 'cancel'];

/**
 * Разрешённые сервером переходы → кнопки.
 *  - confirmed: из awaiting_deposit — «подтвердить без депозита» (сервер требует причину отказа от депозита);
 *  - arrived / no_show — отметки прихода (сервер отдаёт их только когда время позволяет);
 *  - canReschedule — перенос / пересадка; cancelled — отмена с причиной.
 * Неизвестные и системные переходы (expired, pending) кнопками не становятся. Без права reservations.manage
 * в филиале брони — кнопок нет (сервер всё равно отклонит).
 */
export function reservationActions(source: ActionSource, canManage: boolean): ReservationAction[] {
  if (!canManage || source.kind === 'banquet') return [];
  const allowed = new Set(source.allowedTransitions);
  const keys: ReservationActionKey[] = [];
  if (allowed.has('confirmed')) keys.push(source.status === 'awaiting_deposit' ? 'confirmWaive' : 'confirm');
  if (allowed.has('arrived')) keys.push('arrived');
  if (allowed.has('no_show')) keys.push('noShow');
  if (source.canReschedule) keys.push('reschedule');
  if (allowed.has('cancelled')) keys.push('cancel');
  keys.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  let primaryGiven = false;
  return keys.map((key) => {
    let emphasis: ReservationAction['emphasis'] = 'default';
    if (key === 'cancel') emphasis = 'danger';
    else if (!primaryGiven && (key === 'confirm' || key === 'arrived')) {
      emphasis = 'primary';
      primaryGiven = true;
    }
    return { key, emphasis, needsDialog: key === 'confirmWaive' || key === 'reschedule' || key === 'cancel' };
  });
}

/** Быстрые действия в строке очереди/списка (без карточки): подтверждение, отметки прихода. */
export function quickActions(source: ActionSource, canManage: boolean): ReservationAction[] {
  return reservationActions(source, canManage).filter((a) => a.key === 'confirm' || a.key === 'arrived' || a.key === 'noShow');
}

// ---------------------------------------------------------------- отмена: правило депозита

export type CancelDepositCase =
  /** Депозита нет, от него отказались или он уже закрыт — решение не требуется. */
  | 'none'
  /** Депозит ещё не оплачен — ожидающий платёж будет отменён. */
  | 'pending_payment'
  /** Депозит оплачен — вернуть или удержать (по правилу или решением сотрудника). */
  | 'paid';

export interface CancelDepositPolicy {
  case: CancelDepositCase;
  /** Что предписывает правило места при отмене сейчас (посчитал сервер). */
  policyOutcome: DepositOutcome;
  /** Отмена до дедлайна бесплатной отмены. */
  beforeDeadline: boolean;
  deadline: string;
  deadlineHours: number;
}

/** Объяснение правила отмены по данным сервера (depositState, depositOutcomeIfCancelled, дедлайн). */
export function cancelDepositPolicy(detail: {
  depositState: DepositState;
  depositOutcomeIfCancelled: DepositOutcome;
  cancellationDeadline: string;
  rules: { cancellationDeadlineHours: number };
}): CancelDepositPolicy {
  const depositCase: CancelDepositCase =
    detail.depositState === 'paid' ? 'paid' : detail.depositState === 'pending' ? 'pending_payment' : 'none';
  return {
    case: depositCase,
    policyOutcome: detail.depositOutcomeIfCancelled,
    beforeDeadline: detail.depositOutcomeIfCancelled === 'refunded',
    deadline: detail.cancellationDeadline,
    deadlineHours: detail.rules.cancellationDeadlineHours,
  };
}

/** 'policy' — по правилу места (сервер решит сам), иначе явное решение сотрудника. */
export type CancelDepositChoice = 'policy' | DepositDecision;

export interface CancelFormValues {
  reason?: string | null;
  decision?: CancelDepositChoice | null;
}

export const CANCEL_REASON_MAX = 500;

export type CancelFormIssue = 'reason_required' | 'reason_too_long';

export function validateCancel(values: CancelFormValues): Partial<Record<'reason', CancelFormIssue>> {
  const reason = values.reason?.trim() ?? '';
  if (!reason) return { reason: 'reason_required' };
  if (reason.length > CANCEL_REASON_MAX) return { reason: 'reason_too_long' };
  return {};
}

/**
 * Тело POST /cancel. Решение по депозиту передаётся только для оплаченного депозита и только если сотрудник
 * выбрал его явно; иначе сервер применяет правило отмены места.
 */
export function toCancelPayload(values: CancelFormValues, policy: CancelDepositPolicy): CancelReservationInput {
  const reason = (values.reason ?? '').trim();
  if (!reason) throw new Error('reason is required');
  const decision = values.decision ?? 'policy';
  if (policy.case !== 'paid' || decision === 'policy') return { reason };
  return { reason, depositDecision: decision };
}

/** Итог по депозиту при выбранном решении (для подсказки в диалоге): решение сотрудника имеет приоритет. */
export function expectedDepositOutcome(policy: CancelDepositPolicy, decision: CancelDepositChoice): DepositOutcome {
  if (policy.case !== 'paid') return 'none';
  if (decision === 'policy') return policy.policyOutcome;
  return decision === 'refund' ? 'refunded' : 'retained';
}

/** Решение сотрудника расходится с правилом (фиксируется в журнале действий). */
export function overridesPolicy(policy: CancelDepositPolicy, decision: CancelDepositChoice): boolean {
  return policy.case === 'paid' && decision !== 'policy' && expectedDepositOutcome(policy, decision) !== policy.policyOutcome;
}
