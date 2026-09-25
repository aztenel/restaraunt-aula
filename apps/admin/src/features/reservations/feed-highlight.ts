/**
 * Новые брони из ленты событий (useAdminFeed, поток 'reservations', kind «создана» — в т.ч. оплаченный депозит
 * у места с ручным подтверждением): подсветка в очереди, списке и календаре до просмотра, счётчик новых.
 * Звук играет FeedProvider.
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

export const SEEN_LIMIT = 300;

/** Отметить просмотренными (новые — в начало, список ограничен). */
export function markSeen(seen: readonly string[], ids: readonly string[]): string[] {
  const fresh = ids.filter((id) => !seen.includes(id));
  if (fresh.length === 0) return [...seen];
  return [...fresh, ...seen].slice(0, SEEN_LIMIT);
}
