/**
 * Протокол ленты событий админки (модуль Notifications):
 *   POST /api/v1/admin/feed/ticket (Bearer)            → { ticket, expiresIn }
 *   GET  /api/v1/admin/feed/stream?ticket=...          → text/event-stream:
 *        event: feed  data: { branchId, stream, kind, entityId, title, sound? }
 *        event: ping
 *   GET  /api/v1/admin/feed/recent?since=<id|ISO>      → события после since (догрузка после переподключения)
 * Сервер (модуль Notifications, FeedItemDto) передаёт также id и occurredAt: id — дедупликация и курсор догрузки.
 */
export const FEED_STREAMS = ['orders', 'reservations', 'banquets', 'system'] as const;
export type FeedStream = (typeof FEED_STREAMS)[number];

export interface FeedEvent {
  branchId: string | null;
  stream: FeedStream;
  /** 'created' — новый элемент очереди (со звуком), 'updated' — изменение. */
  kind: 'created' | 'updated';
  entityId: string;
  title: string;
  sound?: boolean;
  id?: string;
  occurredAt?: string;
}

export interface FeedTicket {
  ticket: string;
  expiresIn: number;
}

export type FeedStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'unavailable';

export function isFeedEvent(value: unknown): value is FeedEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    (e.branchId === null || typeof e.branchId === 'string') &&
    typeof e.stream === 'string' &&
    (FEED_STREAMS as readonly string[]).includes(e.stream) &&
    (e.kind === 'created' || e.kind === 'updated') &&
    typeof e.entityId === 'string' &&
    typeof e.title === 'string'
  );
}
