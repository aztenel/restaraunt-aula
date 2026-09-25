import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeedItem } from '@/shared/feed/feed-reducer';
import { playNotificationSound } from '@/shared/feed/sound';
import type { PipelineColumn } from '../types';
import { arrivedSince, newRequestIds } from './pipeline-utils';

/**
 * Подсветка новых банкетных заявок: события ленты (поток banquets, kind=created — звук уже проиграл
 * FeedProvider) и — если лента недоступна — появление заявки в колонке «Новые» между опросами
 * (тогда звук играет здесь). Подсветка снимается, когда заявка ушла из «Новых» или её открыли.
 */
export function useNewRequestHighlights(
  columns: readonly PipelineColumn[] | undefined,
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

  const feedCreated = useMemo(
    () => feedItems.filter((item) => item.stream === 'banquets' && item.kind === 'created').map((item) => item.entityId),
    [feedItems],
  );
  useEffect(() => add(feedCreated), [feedCreated, add]);

  useEffect(() => {
    if (!columns) return;
    const current = newRequestIds(columns);
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
  }, [columns, add]);

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
