import { describe, expect, it } from 'vitest';
import { INITIAL_FEED_STATE, feedEventKey, matchesBranch, reconnectDelay, reduceFeed, reduceFeedBatch, FEED_HISTORY_LIMIT } from './feed-reducer';
import type { FeedEvent } from './types';

const at = '2026-09-25T10:00:00.000Z';

const order = (overrides: Partial<FeedEvent> = {}): FeedEvent => ({
  branchId: 'gl',
  stream: 'orders',
  kind: 'created',
  entityId: 'o1',
  title: 'Заказ GL-2026-000001',
  sound: true,
  ...overrides,
});

function receive(event: unknown, selectedBranchId: string | null = null, state = INITIAL_FEED_STATE) {
  return reduceFeed(state, { type: 'event', event, receivedAt: at, selectedBranchId, source: 'live' });
}

describe('reduceFeed', () => {
  it('новое событие: в ленту, счётчик непрочитанного, звук, уведомление, инвалидация раздела', () => {
    const { state, effects } = receive(order());
    expect(state.items).toHaveLength(1);
    expect(state.unread.orders).toBe(1);
    expect(state.lastEventAt).toBe(at);
    expect(effects).toEqual({ notify: true, sound: true, invalidate: ['orders'] });
  });

  it('звук только для created с sound=true', () => {
    expect(receive(order({ sound: false })).effects.sound).toBe(false);
    expect(receive(order({ sound: undefined })).effects.sound).toBe(false);
    const updated = receive(order({ kind: 'updated' }));
    expect(updated.effects).toEqual({ notify: false, sound: false, invalidate: ['orders'] });
    expect(updated.state.unread.orders).toBe(0);
  });

  it('учитывает выбранный филиал; события без филиала видны всем', () => {
    const foreign = receive(order({ branchId: 'gv' }), 'gl');
    expect(foreign.state.items).toHaveLength(0);
    expect(foreign.effects.notify).toBe(false);
    expect(foreign.effects.invalidate).toEqual([]);
    expect(receive(order({ branchId: 'gl' }), 'gl').state.items).toHaveLength(1);
    expect(receive(order({ branchId: null, stream: 'banquets' }), 'gl').state.unread.banquets).toBe(1);
    expect(receive(order({ branchId: 'gv' }), null).state.items).toHaveLength(1);
    expect(matchesBranch(order({ branchId: 'gv' }), 'gl')).toBe(false);
  });

  it('дедупликация (повтор при догрузке после переподключения)', () => {
    const first = receive(order({ id: 'e1' }));
    const second = receive(order({ id: 'e1' }), null, first.state);
    expect(second.state).toBe(first.state);
    expect(second.effects.notify).toBe(false);
    expect(feedEventKey(order({ occurredAt: at }))).toBe(`orders:created:o1:${at}`);
  });

  it('игнорирует некорректные события', () => {
    for (const bad of [null, 'text', { stream: 'unknown', kind: 'created', entityId: 'x', title: 't', branchId: null }, { ...order(), kind: 'deleted' }]) {
      const result = receive(bad);
      expect(result.state).toBe(INITIAL_FEED_STATE);
      expect(result.effects.notify).toBe(false);
    }
  });

  it('ограничивает историю и отмечает прочитанное', () => {
    let state = INITIAL_FEED_STATE;
    for (let i = 0; i < FEED_HISTORY_LIMIT + 10; i++) {
      state = receive(order({ id: `e${i}`, entityId: `o${i}` }), null, state).state;
    }
    expect(state.items).toHaveLength(FEED_HISTORY_LIMIT);
    expect(state.items[0]?.entityId).toBe(`o${FEED_HISTORY_LIMIT + 9}`);
    expect(state.unread.orders).toBe(FEED_HISTORY_LIMIT + 10);
    const read = reduceFeed(state, { type: 'markRead', stream: 'orders' }).state;
    expect(read.unread.orders).toBe(0);
    expect(reduceFeed(state, { type: 'reset' }).state).toBe(INITIAL_FEED_STATE);
  });

  it('lastEventAt — по occurredAt события, если он есть', () => {
    const { state } = receive(order({ occurredAt: '2026-09-25T11:00:00.000Z' }));
    expect(state.lastEventAt).toBe('2026-09-25T11:00:00.000Z');
    const older = receive(order({ id: 'x', occurredAt: '2026-09-25T09:00:00.000Z' }), null, state);
    expect(older.state.lastEventAt).toBe('2026-09-25T11:00:00.000Z');
  });
});

describe('reduceFeedBatch (догрузка пропущенного)', () => {
  it('одно уведомление и один звук на пачку, инвалидация всех затронутых разделов', () => {
    const events = [
      order({ id: 'a' }),
      order({ id: 'b', stream: 'reservations', sound: false }),
      order({ id: 'c', kind: 'updated', stream: 'banquets' }),
      order({ id: 'a' }),
    ];
    const result = reduceFeedBatch(INITIAL_FEED_STATE, events, { receivedAt: at, selectedBranchId: null, source: 'backfill' });
    expect(result.created.map((i) => i.id)).toEqual(['a', 'b']);
    expect(result.effects.notify).toBe(true);
    expect(result.effects.sound).toBe(true);
    expect(result.effects.invalidate.sort()).toEqual(['banquets', 'orders', 'reservations']);
    expect(result.state.items).toHaveLength(3);
  });
});

describe('reconnectDelay', () => {
  it('экспоненциально растёт до потолка 30 с', () => {
    const noJitter = () => 0;
    expect(reconnectDelay(0, noJitter)).toBe(900);
    expect(reconnectDelay(1, noJitter)).toBe(1800);
    expect(reconnectDelay(3, noJitter)).toBe(7200);
    expect(reconnectDelay(10, noJitter)).toBe(27000);
    expect(reconnectDelay(10, () => 1)).toBe(30000);
  });
});
