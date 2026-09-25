import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem } from '@/shared/feed/feed-reducer';
import { playNotificationSound } from '@/shared/feed/sound';
import type { OrderQueue } from '../types';
import { arrivedSince, newOrderIds } from './queue-utils';

/**
 * Подсветка новых заказов в колонке «Новые»: события ленты (kind=created) и — если лента недоступна —
 * появление заказа между опросами очереди (тогда звук играет здесь, иначе его играет лента).
 * Подсветка снимается, когда заказ ушёл из «Новых» или сотрудник открыл его.
 */
export function useNewOrderHighlights(
  queue: OrderQueue | undefined,
  feedItems: readonly FeedItem[],
  options: { soundOnPoll: boolean },
): { highlighted: ReadonlySet<string>; acknowledge: (id: string) => void } {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const acknowledged = useRef(new Set<string>());
  const previous = useRef<ReadonlySet<string> | null>(null);
  const soundRef = useRef(options.soundOnPoll);
  soundRef.current = options.soundOnPoll;

  const add = useCallback((ids: readonly string[]) => {
    const next = ids.filter((id) => !acknowledged.current.has(id));
    if (next.length === 0) return;
    setFresh((current) => new Set([...current, ...next]));
  }, []);

  // Лента: новые заказы (звук уже проиграл FeedProvider).
  const feedCreated = useMemo(
    () => feedItems.filter((item) => item.stream === 'orders' && item.kind === 'created').map((item) => item.entityId),
    [feedItems],
  );
  useEffect(() => add(feedCreated), [feedCreated, add]);

  // Опрос: новые id в «Новых» с прошлого ответа; ушедшие из «Новых» — без подсветки.
  useEffect(() => {
    if (!queue) return;
    const current = newOrderIds(queue);
    const arrived = arrivedSince(previous.current, current);
    previous.current = current;
    if (arrived.length > 0) {
      add(arrived);
      if (soundRef.current) playNotificationSound();
    }
    setFresh((existing) => {
      const kept = [...existing].filter((id) => current.has(id));
      return kept.length === existing.size ? existing : new Set(kept);
    });
  }, [queue, add]);

  const acknowledge = useCallback((id: string) => {
    acknowledged.current.add(id);
    setFresh((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  return { highlighted: fresh, acknowledge };
}
