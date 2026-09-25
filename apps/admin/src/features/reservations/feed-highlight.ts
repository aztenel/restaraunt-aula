/**
 * Новые брони из ленты событий (useAdminFeed, поток 'reservations'): подсветка в очереди, списке
 * и календаре до просмотра, счётчик новых и звуковой сигнал о брони, которая появилась в очереди
 * «ждут подтверждения» без события «создана» (например, гость оплатил депозит, место с ручным подтверждением).
 */
export interface FeedLike {
  stream: string;
  kind: string;
  entityId: string;
}

/** id новых броней (событие «создана»), ещё не просмотренных; порядок — как в ленте (новые первыми), без повторов. */
export function newReservationIds(items: readonly FeedLike[], seen: ReadonlySet<string>): string[] {
  const result: string[] = [];
  for (const item of items) {
    if (item.stream !== 'reservations' || item.kind !== 'created') continue;
    if (seen.has(item.entityId) || result.includes(item.entityId)) continue;
    result.push(item.entityId);
  }
  return result;
}

/** Все брони, о которых лента уже сообщила как о новых (о них звук уже был). */
export function announcedIds(items: readonly FeedLike[]): Set<string> {
  return new Set(items.filter((i) => i.stream === 'reservations' && i.kind === 'created').map((i) => i.entityId));
}

/**
 * Какие id появились в очереди с прошлого раза. previous = null — первая загрузка (не сигналим).
 * ignore — брони, о которых лента уже просигналила.
 */
export function newlyAppeared(previous: ReadonlySet<string> | null, next: readonly string[], ignore: ReadonlySet<string>): string[] {
  if (previous === null) return [];
  return next.filter((id) => !previous.has(id) && !ignore.has(id));
}

export const SEEN_LIMIT = 300;

/** Отметить просмотренными (новые — в начало, список ограничен). */
export function markSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !seen.includes(id));
  if (fresh.length === 0) return [...seen];
  return [...fresh, ...seen].slice(0, SEEN_LIMIT);
}
