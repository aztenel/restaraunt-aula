import { describe, expect, it } from 'vitest';
import { canEditQuoteIn, canInvoiceIn, canIssueActFor, canRetryEsf, canSendQuoteVersion, requestActions } from './request-actions';

const keys = (actions: Array<{ key: string }>) => actions.map((a) => a.key);

describe('кнопки воронки из allowedTransitions', () => {
  it('new: взять в работу (главная) и отменить', () => {
    expect(requestActions({ status: 'new', allowedTransitions: ['in_progress', 'cancelled'] }, true)).toEqual([
      { key: 'take', to: 'in_progress', emphasis: 'primary', confirm: false, needsReason: false },
      { key: 'cancel', to: 'cancelled', emphasis: 'danger', confirm: false, needsReason: true },
    ]);
  });

  it('in_progress без сметы: сервер не разрешил отправку — только отмена', () => {
    expect(keys(requestActions({ status: 'in_progress', allowedTransitions: ['cancelled'] }, true))).toEqual(['cancel']);
  });

  it('in_progress со сметой: отправить смету (главная, с подтверждением)', () => {
    const actions = requestActions({ status: 'in_progress', allowedTransitions: ['quote_sent', 'cancelled'] }, true);
    expect(actions[0]).toEqual({ key: 'sendQuote', to: 'quote_sent', emphasis: 'primary', confirm: true, needsReason: false });
  });

  it('quote_sent: клиент согласовал (главная), вернуть на доработку, отменить', () => {
    const actions = requestActions({ status: 'quote_sent', allowedTransitions: ['in_progress', 'agreed', 'cancelled'] }, true);
    expect(keys(actions)).toEqual(['agree', 'rework', 'cancel']);
    expect(actions.map((a) => a.emphasis)).toEqual(['primary', 'default', 'danger']);
    expect(actions[1]).toMatchObject({ to: 'in_progress', confirm: true });
  });

  it('agreed: новая версия сметы и отметка предоплаты — только если сервер разрешил', () => {
    expect(keys(requestActions({ status: 'agreed', allowedTransitions: ['quote_sent', 'cancelled'] }, true))).toEqual(['sendNewVersion', 'cancel']);
    const withPrepaid = requestActions({ status: 'agreed', allowedTransitions: ['quote_sent', 'prepaid', 'cancelled'] }, true);
    expect(keys(withPrepaid)).toEqual(['sendNewVersion', 'prepaid', 'cancel']);
    expect(withPrepaid[0]!.emphasis).toBe('primary');
  });

  it('prepaid: «проведено» появляется только в день мероприятия (решает сервер)', () => {
    expect(keys(requestActions({ status: 'prepaid', allowedTransitions: ['cancelled'] }, true))).toEqual(['cancel']);
    const held = requestActions({ status: 'prepaid', allowedTransitions: ['held', 'cancelled'] }, true);
    expect(held[0]).toEqual({ key: 'held', to: 'held', emphasis: 'primary', confirm: true, needsReason: false });
  });

  it('финальные статусы и неизвестные переходы — без кнопок', () => {
    expect(requestActions({ status: 'held', allowedTransitions: [] }, true)).toEqual([]);
    expect(requestActions({ status: 'new', allowedTransitions: ['new', 'archived'] }, true)).toEqual([]);
  });

  it('без права banquets.manage — без кнопок', () => {
    expect(requestActions({ status: 'new', allowedTransitions: ['in_progress', 'cancelled'] }, false)).toEqual([]);
  });

  it('порядок кнопок не зависит от порядка переходов в ответе', () => {
    expect(keys(requestActions({ status: 'quote_sent', allowedTransitions: ['cancelled', 'agreed', 'in_progress'] }, true))).toEqual([
      'agree',
      'rework',
      'cancel',
    ]);
  });
});

describe('подсказки видимости', () => {
  it('смету можно менять до согласования включительно', () => {
    expect(['new', 'in_progress', 'quote_sent', 'agreed'].every(canEditQuoteIn)).toBe(true);
    expect(['prepaid', 'held', 'cancelled'].some(canEditQuoteIn)).toBe(false);
  });

  it('счета — после согласования сметы', () => {
    expect(['agreed', 'prepaid', 'held'].every(canInvoiceIn)).toBe(true);
    expect(['new', 'in_progress', 'quote_sent', 'cancelled'].some(canInvoiceIn)).toBe(false);
  });

  it('отправить можно только последнюю неотправленную версию', () => {
    expect(canSendQuoteVersion('in_progress', { isLatest: true, sentAt: null })).toBe(true);
    expect(canSendQuoteVersion('quote_sent', { isLatest: true, sentAt: '2026-10-01T10:00:00Z' })).toBe(false);
    expect(canSendQuoteVersion('quote_sent', { isLatest: false, sentAt: null })).toBe(false);
    expect(canSendQuoteVersion('prepaid', { isLatest: true, sentAt: null })).toBe(false);
  });

  it('акт — после проведения, один; ЭСФ — повтор при ошибке или черновике', () => {
    expect(canIssueActFor('held', false)).toBe(true);
    expect(canIssueActFor('held', true)).toBe(false);
    expect(canIssueActFor('prepaid', false)).toBe(false);
    expect(canRetryEsf('failed')).toBe(true);
    expect(canRetryEsf('draft_ready')).toBe(true);
    expect(canRetryEsf('registered')).toBe(false);
    expect(canRetryEsf('pending')).toBe(false);
  });
});
