import { describe, expect, it, vi } from 'vitest';
import { SessionManager } from './session';

function manager(refresh: () => Promise<{ accessToken: string; expiresIn: number; mustChangePassword: boolean }>) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const m = new SessionManager({
    refresh,
    now: () => 1_000_000,
    locks: null,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => undefined,
  });
  return { m, timers };
}

describe('SessionManager', () => {
  it('однопоточное обновление: параллельные 401 ждут один запрос', async () => {
    const refresh = vi.fn(async () => ({ accessToken: 'new', expiresIn: 900, mustChangePassword: false }));
    const { m } = manager(refresh);
    const results = await Promise.all([m.refresh(), m.refresh(), m.refresh()]);
    expect(results).toEqual([true, true, true]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(m.getAccessToken()).toBe('new');
  });

  it('проактивное обновление за минуту до истечения', () => {
    const { m, timers } = manager(async () => ({ accessToken: 'x', expiresIn: 900, mustChangePassword: false }));
    m.setSession({ accessToken: 'a', expiresIn: 900, mustChangePassword: true });
    expect(m.getState()).toMatchObject({ accessToken: 'a', expiresAt: 1_000_000 + 900_000, mustChangePassword: true });
    expect(timers.at(-1)?.ms).toBe(840_000);
  });

  it('неудачное обновление очищает сессию и сообщает подписчикам', async () => {
    const { m } = manager(async () => {
      throw new Error('403');
    });
    m.setSession({ accessToken: 'a', expiresIn: 900, mustChangePassword: false });
    const reasons: string[] = [];
    m.subscribe((_, reason) => reasons.push(reason));
    expect(await m.refresh()).toBe(false);
    expect(m.getAccessToken()).toBeNull();
    expect(reasons).toEqual(['expired']);
  });
});
