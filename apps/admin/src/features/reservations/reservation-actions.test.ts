import { describe, expect, it } from 'vitest';
import {
  cancelDepositPolicy,
  expectedDepositOutcome,
  overridesPolicy,
  quickActions,
  reservationActions,
  toCancelPayload,
  validateCancel,
} from './reservation-actions';

const keys = (actions: Array<{ key: string }>) => actions.map((a) => a.key);
const regular = (status: string, allowedTransitions: string[], canReschedule = false) =>
  ({ kind: 'regular', status, allowedTransitions, canReschedule }) as Parameters<typeof reservationActions>[0];

describe('кнопки брони из allowedTransitions', () => {
  it('pending: подтвердить (главная), перенести, отменить', () => {
    const actions = reservationActions(regular('pending', ['confirmed', 'cancelled'], true), true);
    expect(actions).toEqual([
      { key: 'confirm', emphasis: 'primary', needsDialog: false },
      { key: 'reschedule', emphasis: 'default', needsDialog: true },
      { key: 'cancel', emphasis: 'danger', needsDialog: true },
    ]);
  });

  it('awaiting_deposit → confirmed — подтверждение без депозита (нужна причина)', () => {
    const actions = reservationActions(regular('awaiting_deposit', ['confirmed', 'cancelled'], true), true);
    expect(keys(actions)).toEqual(['confirmWaive', 'reschedule', 'cancel']);
    expect(actions[0]).toMatchObject({ needsDialog: true, emphasis: 'default' });
  });

  it('confirmed до начала: «не пришли» сервер ещё не разрешил — кнопки нет', () => {
    const actions = reservationActions(regular('confirmed', ['arrived', 'cancelled'], true), true);
    expect(keys(actions)).toEqual(['arrived', 'reschedule', 'cancel']);
    expect(actions[0]!.emphasis).toBe('primary');
  });

  it('confirmed после начала: «пришли» и «не пришли»', () => {
    expect(keys(reservationActions(regular('confirmed', ['no_show', 'arrived', 'cancelled'], true), true))).toEqual([
      'arrived',
      'noShow',
      'reschedule',
      'cancel',
    ]);
  });

  it('системные и неизвестные переходы (expired, pending) кнопками не становятся', () => {
    expect(reservationActions(regular('awaiting_deposit', ['expired', 'pending', 'teleported']), true)).toEqual([]);
  });

  it('финальные статусы — нет кнопок', () => {
    expect(reservationActions(regular('arrived', []), true)).toEqual([]);
    expect(reservationActions(regular('cancelled', []), true)).toEqual([]);
  });

  it('банкетная занятость управляется модулем банкетов — нет кнопок', () => {
    expect(reservationActions({ kind: 'banquet', status: 'confirmed', allowedTransitions: ['cancelled'], canReschedule: true }, true)).toEqual([]);
  });

  it('без права reservations.manage в филиале — нет кнопок', () => {
    expect(reservationActions(regular('pending', ['confirmed', 'cancelled'], true), false)).toEqual([]);
  });

  it('быстрые действия очереди — только подтверждение и отметки прихода', () => {
    expect(keys(quickActions(regular('confirmed', ['arrived', 'no_show', 'cancelled'], true), true))).toEqual(['arrived', 'noShow']);
    expect(keys(quickActions(regular('awaiting_deposit', ['confirmed', 'cancelled'], true), true))).toEqual([]);
  });
});

describe('отмена: правило депозита по данным сервера', () => {
  const detail = (depositState: string, depositOutcomeIfCancelled: string) =>
    ({
      depositState,
      depositOutcomeIfCancelled,
      cancellationDeadline: '2026-10-24T14:00:00.000Z',
      rules: { cancellationDeadlineHours: 24 },
    }) as Parameters<typeof cancelDepositPolicy>[0];

  it('оплаченный депозит до дедлайна — по правилу возвращается', () => {
    const policy = cancelDepositPolicy(detail('paid', 'refunded'));
    expect(policy).toEqual({
      case: 'paid',
      policyOutcome: 'refunded',
      beforeDeadline: true,
      deadline: '2026-10-24T14:00:00.000Z',
      deadlineHours: 24,
    });
    expect(expectedDepositOutcome(policy, 'policy')).toBe('refunded');
    expect(overridesPolicy(policy, 'refund')).toBe(false);
    expect(overridesPolicy(policy, 'retain')).toBe(true);
  });

  it('после дедлайна — по правилу удерживается, сотрудник может вернуть (решение в журнале)', () => {
    const policy = cancelDepositPolicy(detail('paid', 'retained'));
    expect(policy.beforeDeadline).toBe(false);
    expect(expectedDepositOutcome(policy, 'refund')).toBe('refunded');
    expect(overridesPolicy(policy, 'refund')).toBe(true);
  });

  it('неоплаченный депозит — ожидающий платёж отменяется, решение не нужно', () => {
    const policy = cancelDepositPolicy(detail('pending', 'none'));
    expect(policy.case).toBe('pending_payment');
    expect(toCancelPayload({ reason: 'Гость передумал', decision: 'refund' }, policy)).toEqual({ reason: 'Гость передумал' });
  });

  it('тело отмены: причина обязательна, решение — только явное и только для оплаченного депозита', () => {
    const paid = cancelDepositPolicy(detail('paid', 'retained'));
    expect(toCancelPayload({ reason: '  Звонок гостя ', decision: 'policy' }, paid)).toEqual({ reason: 'Звонок гостя' });
    expect(toCancelPayload({ reason: 'Звонок гостя', decision: 'refund' }, paid)).toEqual({ reason: 'Звонок гостя', depositDecision: 'refund' });
    expect(toCancelPayload({ reason: 'Звонок гостя' }, paid)).toEqual({ reason: 'Звонок гостя' });
    expect(() => toCancelPayload({ reason: ' ' }, paid)).toThrow();
    expect(toCancelPayload({ reason: 'x', decision: 'retain' }, cancelDepositPolicy(detail('none', 'none')))).toEqual({ reason: 'x' });
  });

  it('проверка формы отмены', () => {
    expect(validateCancel({ reason: '' })).toEqual({ reason: 'reason_required' });
    expect(validateCancel({ reason: 'a'.repeat(501) })).toEqual({ reason: 'reason_too_long' });
    expect(validateCancel({ reason: 'ok' })).toEqual({});
  });
});
