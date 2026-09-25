import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../../../shared/kernel/errors';
import { availableTransitions, BANQUET_FSM, OPEN_BANQUET_STATUSES, TransitionContext } from './banquet-status';

describe('BANQUET_FSM', () => {
  it('follows the funnel from the spec', () => {
    expect(BANQUET_FSM.allowedFrom('new')).toEqual(['in_progress', 'cancelled']);
    expect(BANQUET_FSM.allowedFrom('in_progress')).toEqual(['quote_sent', 'cancelled']);
    expect(BANQUET_FSM.allowedFrom('quote_sent')).toEqual(['in_progress', 'agreed', 'cancelled']);
    expect(BANQUET_FSM.allowedFrom('agreed')).toEqual(['quote_sent', 'prepaid', 'cancelled']);
    expect(BANQUET_FSM.allowedFrom('prepaid')).toEqual(['held', 'cancelled']);
    expect(BANQUET_FSM.isFinal('held')).toBe(true);
    expect(BANQUET_FSM.isFinal('cancelled')).toBe(true);
  });

  it('cancellation is possible from every unfinished status', () => {
    for (const s of OPEN_BANQUET_STATUSES) expect(BANQUET_FSM.canTransition(s, 'cancelled')).toBe(true);
    expect(OPEN_BANQUET_STATUSES).not.toContain('held');
    expect(OPEN_BANQUET_STATUSES).not.toContain('cancelled');
  });

  it('rejects skipping stages', () => {
    expect(() => BANQUET_FSM.assertTransition('new', 'agreed')).toThrow(InvalidStateTransitionError);
    expect(() => BANQUET_FSM.assertTransition('in_progress', 'prepaid')).toThrow(InvalidStateTransitionError);
    expect(() => BANQUET_FSM.assertTransition('agreed', 'held')).toThrow(InvalidStateTransitionError);
    expect(() => BANQUET_FSM.assertTransition('held', 'cancelled')).toThrow(/banquet: transition held -> cancelled/);
  });
});

describe('availableTransitions', () => {
  const base: TransitionContext = {
    status: 'in_progress',
    hasQuote: false,
    latestQuoteSent: false,
    prepaymentCovered: false,
    eventDateReached: false,
  };

  it('offers quote_sent only when a quote exists', () => {
    expect(availableTransitions(base)).toEqual(['cancelled']);
    expect(availableTransitions({ ...base, hasQuote: true })).toEqual(['quote_sent', 'cancelled']);
  });

  it('offers agreed only for a sent latest version', () => {
    expect(availableTransitions({ ...base, status: 'quote_sent', hasQuote: true })).toEqual(['in_progress', 'cancelled']);
    expect(availableTransitions({ ...base, status: 'quote_sent', hasQuote: true, latestQuoteSent: true })).toEqual([
      'in_progress',
      'agreed',
      'cancelled',
    ]);
  });

  it('offers prepaid only when prepayment is covered and held only after the event date', () => {
    expect(availableTransitions({ ...base, status: 'agreed', hasQuote: true })).toEqual(['quote_sent', 'cancelled']);
    expect(availableTransitions({ ...base, status: 'agreed', hasQuote: true, prepaymentCovered: true })).toContain('prepaid');
    expect(availableTransitions({ ...base, status: 'prepaid' })).toEqual(['cancelled']);
    expect(availableTransitions({ ...base, status: 'prepaid', eventDateReached: true })).toEqual(['held', 'cancelled']);
    expect(availableTransitions({ ...base, status: 'held', eventDateReached: true })).toEqual([]);
  });
});
