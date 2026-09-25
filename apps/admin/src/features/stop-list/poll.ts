import type { FeedStatus } from '@/shared/feed/types';

/**
 * Обновление стоп-листа: изменения приходят лентой событий (очередь orders, entityType dish —
 * FeedProvider обновляет меню филиала). Опрос — запасной канал: раз в 30 с без ленты, раз в 2 мин с ней.
 */
export const STOP_LIST_POLL_MS = 30_000;
export const STOP_LIST_POLL_WITH_FEED_MS = 120_000;

/** Интервал опроса стоп-листа в зависимости от состояния ленты событий. */
export function stopListPollInterval(feedStatus: FeedStatus): number {
  return feedStatus === 'open' ? STOP_LIST_POLL_WITH_FEED_MS : STOP_LIST_POLL_MS;
}
