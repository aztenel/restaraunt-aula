import { describe, expect, it } from 'vitest';
import { STOP_LIST_POLL_MS, STOP_LIST_POLL_WITH_FEED_MS, stopListPollInterval } from './poll';

describe('опрос стоп-листа — запасной канал к ленте событий', () => {
  it('лента подключена — изменения приходят ею, опрос редкий', () => {
    expect(stopListPollInterval('open')).toBe(STOP_LIST_POLL_WITH_FEED_MS);
    expect(STOP_LIST_POLL_WITH_FEED_MS).toBeGreaterThan(STOP_LIST_POLL_MS);
  });

  it('ленты нет (подключается, переподключается, недоступна) — частый опрос', () => {
    for (const status of ['idle', 'connecting', 'reconnecting', 'unavailable'] as const) {
      expect(stopListPollInterval(status)).toBe(STOP_LIST_POLL_MS);
    }
  });
});
