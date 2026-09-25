/** Общие хуки раздела броней: часовой пояс филиала, «сейчас», дата в адресе, новые брони из ленты. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useBranch } from '@/shared/branch/BranchProvider';
import { useAdminFeed } from '@/shared/feed/FeedProvider';
import { playNotificationSound } from '@/shared/feed/sound';
import { useStoredState } from '@/shared/lib/storage';
import { announcedIds, markSeen, newlyAppeared, newReservationIds } from './feed-highlight';
import { DEFAULT_TZ } from './format';
import { todayIn } from './timeline-layout';

export function useBranchTimezone(branchId: string | null | undefined): string {
  const { getBranch } = useBranch();
  return getBranch(branchId)?.timezone ?? DEFAULT_TZ;
}

/** Текущее время, обновляется раз в intervalMs (отсчёты удержания, линия «сейчас»). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Дата календаря / карты в адресе (?date=YYYY-MM-DD); по умолчанию — сегодня в часовом поясе филиала. */
export function useReservationDate(tz: string): [string, (date: string) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('date');
  const date = raw && DATE_RE.test(raw) ? raw : todayIn(tz);
  const setDate = useCallback(
    (next: string) =>
      setParams(
        (prev) => {
          const copy = new URLSearchParams(prev);
          copy.set('date', next);
          return copy;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [date, setDate];
}

const SEEN_KEY = 'aula_admin_reservations_seen';

/** Новые брони из ленты событий, ещё не просмотренные сотрудником. */
export function useNewReservations() {
  const { items } = useAdminFeed();
  const [seen, setSeen] = useStoredState<string[]>(SEEN_KEY, []);
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const ids = useMemo(() => newReservationIds(items, new Set(seen)), [items, seen]);
  const newIds = useMemo(() => new Set(ids), [ids]);
  const announced = useMemo(() => announcedIds(items), [items]);
  const acknowledge = useCallback(
    (id: string) => {
      if (!seenRef.current.includes(id)) setSeen(markSeen(seenRef.current, [id]));
    },
    [setSeen],
  );
  const acknowledgeAll = useCallback(() => setSeen(markSeen(seenRef.current, ids)), [ids, setSeen]);
  return { newIds, count: ids.length, announced, acknowledge, acknowledgeAll };
}

/**
 * Звук, когда в очереди появляется бронь без события ленты «создана» (оплачен депозит, а место требует
 * ручного подтверждения). Первая загрузка и смена филиала не звучат; настройка звука — общая (шапка).
 */
export function useQueueArrivalSound(ids: readonly string[] | undefined, scopeKey: string, announced: ReadonlySet<string>): void {
  const { soundEnabled } = useAdminFeed();
  const previous = useRef<{ scope: string; ids: Set<string> } | null>(null);
  const announcedRef = useRef(announced);
  announcedRef.current = announced;
  const soundRef = useRef(soundEnabled);
  soundRef.current = soundEnabled;
  useEffect(() => {
    if (!ids) return;
    const prev = previous.current && previous.current.scope === scopeKey ? previous.current.ids : null;
    const appeared = newlyAppeared(prev, ids, announcedRef.current);
    previous.current = { scope: scopeKey, ids: new Set(ids) };
    if (appeared.length > 0 && soundRef.current) playNotificationSound();
  }, [ids, scopeKey]);
}

// ---------------------------------------------------------------- действия страницы (открыть бронь, новая бронь)

export interface BookingPrefill {
  venueId?: string;
  date?: string;
  time?: string;
  guests?: number;
}

export interface ReservationsUi {
  openReservation(id: string): void;
  openBooking(prefill?: BookingPrefill): void;
  /** Можно создавать брони в выбранном филиале. */
  canCreate: boolean;
  newIds: ReadonlySet<string>;
  acknowledge(id: string): void;
}

export const ReservationsUiContext = createContext<ReservationsUi | null>(null);

export function useReservationsUi(): ReservationsUi {
  const value = useContext(ReservationsUiContext);
  if (!value) throw new Error('useReservationsUi must be used inside <ReservationsPage>');
  return value;
}
