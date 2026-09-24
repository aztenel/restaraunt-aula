import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from './errors';
import { StateMachine } from './state-machine';

describe('StateMachine', () => {
  const fsm = new StateMachine<'a' | 'b' | 'c'>('test', { a: ['b'], b: ['c'], c: [] });

  it('allows only listed transitions', () => {
    expect(fsm.canTransition('a', 'b')).toBe(true);
    expect(fsm.canTransition('a', 'c')).toBe(false);
    expect(() => fsm.assertTransition('a', 'c')).toThrow(InvalidStateTransitionError);
    expect(fsm.isFinal('c')).toBe(true);
  });
});
