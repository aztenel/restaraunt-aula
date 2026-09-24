/**
 * Обработка событий ленты — чистая функция (тестируется без браузера):
 * фильтр по выбранному филиалу, дедупликация, счётчики непрочитанного и «эффекты»:
 * показать уведомление, проиграть звук, инвалидировать запросы раздела.
 */
import { FEED_STREAMS, isFeedEvent, type FeedEvent, type FeedStream } from './types';

export const FEED_HISTORY_LIMIT = 100;
const SEEN_LIMIT = 500;

export interface FeedItem extends FeedEvent {
  key: string;
  receivedAt: string;
}

export interface FeedState {
  items: FeedItem[];
  unread: Record<FeedStream, number>;
  /** Время последнего события (для догрузки GET /feed/recent?since=). */
  lastEventAt: string | null;
  seen: string[];
}

export interface FeedEffects {
  notify: boolean;
  sound: boolean;
  invalidate: FeedStream[];
}

export type FeedAction =
  | {
      type: 'event';
      event: unknown;
      receivedAt: string;
      /** Выбранный в шапке филиал; null — «Все филиалы». */
      selectedBranchId: string | null;
      source: 'live' | 'backfill';
    }
  | { type: 'markRead'; stream?: FeedStream }
  | { type: 'reset' };

const zeroUnread = (): Record<FeedStream, number> =>
  Object.fromEntries(FEED_STREAMS.map((s) => [s, 0])) as Record<FeedStream, number>;

export const INITIAL_FEED_STATE: FeedState = { items: [], unread: zeroUnread(), lastEventAt: null, seen: [] };

const NO_EFFECTS: FeedEffects = { notify: false, sound: false, invalidate: [] };

export function feedEventKey(event: FeedEvent): string {
  return event.id ?? `${event.stream}:${event.kind}:${event.entityId}:${event.occurredAt ?? event.title}`;
}

/** Событие относится к выбранному филиалу (события без филиала — общие: выездные банкеты, система). */
export function matchesBranch(event: FeedEvent, selectedBranchId: string | null): boolean {
  return selectedBranchId === null || event.branchId === null || event.branchId === selectedBranchId;
}

function later(a: string | null, b: string): string {
  return a === null || b > a ? b : a;
}

export function reduceFeed(state: FeedState, action: FeedAction): { state: FeedState; effects: FeedEffects } {
  switch (action.type) {
    case 'reset':
      return { state: INITIAL_FEED_STATE, effects: NO_EFFECTS };
    case 'markRead': {
      const unread = { ...state.unread };
      for (const stream of action.stream ? [action.stream] : FEED_STREAMS) unread[stream] = 0;
      return { state: { ...state, unread }, effects: NO_EFFECTS };
    }
    case 'event': {
      if (!isFeedEvent(action.event)) return { state, effects: NO_EFFECTS };
      const event = action.event;
      const at = event.occurredAt ?? action.receivedAt;
      if (!matchesBranch(event, action.selectedBranchId)) {
        // Чужой филиал: не показываем, но время учитываем для догрузки.
        return { state: { ...state, lastEventAt: later(state.lastEventAt, at) }, effects: NO_EFFECTS };
      }
      const key = feedEventKey(event);
      if (state.seen.includes(key)) return { state, effects: NO_EFFECTS };
      const isNew = event.kind === 'created';
      const item: FeedItem = { ...event, key, receivedAt: action.receivedAt };
      const unread = isNew ? { ...state.unread, [event.stream]: state.unread[event.stream] + 1 } : state.unread;
      return {
        state: {
          items: [item, ...state.items].slice(0, FEED_HISTORY_LIMIT),
          unread,
          lastEventAt: later(state.lastEventAt, at),
          seen: [key, ...state.seen].slice(0, SEEN_LIMIT),
        },
        effects: {
          notify: isNew,
          sound: isNew && event.sound === true,
          invalidate: [event.stream],
        },
      };
    }
    default:
      return { state, effects: NO_EFFECTS };
  }
}

/** Применить пачку событий (догрузка) и свести эффекты: одно уведомление/звук на пачку. */
export function reduceFeedBatch(
  state: FeedState,
  events: unknown[],
  context: { receivedAt: string; selectedBranchId: string | null; source: 'live' | 'backfill' },
): { state: FeedState; effects: FeedEffects; created: FeedItem[] } {
  let current = state;
  const invalidate = new Set<FeedStream>();
  const created: FeedItem[] = [];
  let sound = false;
  for (const event of events) {
    const result = reduceFeed(current, { type: 'event', event, ...context });
    if (result.state !== current && result.effects.notify && result.state.items[0]) created.push(result.state.items[0]);
    current = result.state;
    result.effects.invalidate.forEach((s) => invalidate.add(s));
    sound ||= result.effects.sound;
  }
  return { state: current, effects: { notify: created.length > 0, sound, invalidate: [...invalidate] }, created };
}

/** Экспоненциальная задержка переподключения с джиттером: 1 с, 2 с, 4 с … до 30 с. */
export function reconnectDelay(attempt: number, random: () => number = Math.random, baseMs = 1000, maxMs = 30_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  const jitter = exp * 0.2 * random();
  return Math.round(Math.min(maxMs, exp * 0.9 + jitter));
}
