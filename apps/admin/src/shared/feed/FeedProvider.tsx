/**
 * Лента событий админки в реальном времени: очереди новых заказов, броней и банкетных заявок
 * со звуковым уведомлением. Одно SSE-подключение на вкладку; учитывает выбранный филиал;
 * инвалидирует запросы соответствующего раздела ('orders' | 'reservations' | 'banquets' | 'system').
 */
import { useQueryClient } from '@tanstack/react-query';
import { App } from 'antd';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { feedApi } from '../api/endpoints';
import { Permission } from '@aula/api-client';
import { useAuth } from '../auth/AuthProvider';
import { canAnySomewhere } from '../auth/permissions';
import { useBranch } from '../branch/BranchProvider';
import { useStoredState } from '../lib/storage';
import { FeedConnection } from './connection';
import { INITIAL_FEED_STATE, reduceFeed, reduceFeedBatch, type FeedItem, type FeedState } from './feed-reducer';
import { playNotificationSound, unlockAudio } from './sound';
import type { FeedStatus, FeedStream } from './types';

/** Права, с которыми сервер выдаёт билет ленты (notifications/http/admin/feed.controller.ts). */
export const FEED_PERMISSIONS = [Permission.OrdersView, Permission.ReservationsView, Permission.BanquetsView, Permission.SystemJobs];

export const STREAM_PATHS: Record<FeedStream, string> = {
  orders: '/orders',
  reservations: '/reservations',
  banquets: '/banquets',
  system: '/system',
};

export interface AdminFeedValue {
  status: FeedStatus;
  items: FeedItem[];
  unread: Record<FeedStream, number>;
  unreadTotal: number;
  soundEnabled: boolean;
  setSoundEnabled(enabled: boolean): void;
  markRead(stream?: FeedStream): void;
}

const FeedContext = createContext<AdminFeedValue | null>(null);

export function FeedProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, me } = useAuth();
  const feedAllowed = authStatus === 'authenticated' && canAnySomewhere(me, FEED_PERMISSIONS);
  const { selectedBranchId } = useBranch();
  const queryClient = useQueryClient();
  const { notification } = App.useApp();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<FeedState>(INITIAL_FEED_STATE);
  const [status, setStatus] = useState<FeedStatus>('idle');
  const [soundEnabled, setSoundEnabled] = useStoredState('aula_admin_sound', true);

  const stateRef = useRef(state);
  const branchRef = useRef(selectedBranchId);
  const soundRef = useRef(soundEnabled);
  branchRef.current = selectedBranchId;
  soundRef.current = soundEnabled;

  const apply = useCallback((next: FeedState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const handleEvents = useCallback(
    (events: unknown[], source: 'live' | 'backfill') => {
      const result = reduceFeedBatch(stateRef.current, events, {
        receivedAt: new Date().toISOString(),
        selectedBranchId: branchRef.current,
        source,
      });
      apply(result.state);
      for (const stream of result.effects.invalidate) {
        void queryClient.invalidateQueries({ queryKey: [stream] });
      }
      if (result.effects.sound && soundRef.current) playNotificationSound();
      if (result.effects.notify) {
        const [first] = result.created;
        if (result.created.length === 1 && first) {
          notification.info({
            key: first.key,
            message: first.title,
            description: t(`feed.streams.${first.stream}`),
            placement: 'bottomRight',
            onClick: () => navigate(STREAM_PATHS[first.stream]),
          });
        } else {
          notification.info({
            message: t('feed.newEvents', { count: result.created.length }),
            placement: 'bottomRight',
          });
        }
      }
    },
    [apply, navigate, notification, queryClient, t],
  );

  const handlerRef = useRef(handleEvents);
  handlerRef.current = handleEvents;

  useEffect(() => {
    if (!feedAllowed) return;
    const connection = new FeedConnection({
      getTicket: feedApi.ticket,
      getRecent: feedApi.recent,
      streamUrl: feedApi.streamUrl,
      onEvents: (events, source) => handlerRef.current(events, source),
      onStatus: setStatus,
    });
    connection.start();
    return () => connection.stop();
  }, [feedAllowed]);

  // Смена филиала: история и счётчики — заново (события фильтруются по филиалу при получении).
  useEffect(() => {
    apply({ ...INITIAL_FEED_STATE, lastEventAt: stateRef.current.lastEventAt });
  }, [selectedBranchId, apply]);

  // Звук разрешается браузером только после действия пользователя.
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  const unreadTotal = Object.values(state.unread).reduce((sum, n) => sum + n, 0);

  // Счётчик непрочитанного во вкладке браузера.
  useEffect(() => {
    const base = t('app.title');
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${base}` : base;
  }, [unreadTotal, t]);

  const markRead = useCallback((stream?: FeedStream) => apply(reduceFeed(stateRef.current, { type: 'markRead', stream }).state), [apply]);

  const value = useMemo<AdminFeedValue>(
    () => ({
      status,
      items: state.items,
      unread: state.unread,
      unreadTotal,
      soundEnabled,
      setSoundEnabled,
      markRead,
    }),
    [status, state.items, state.unread, unreadTotal, soundEnabled, setSoundEnabled, markRead],
  );

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

/** Лента событий: статус подключения, последние события, непрочитанные по очередям, звук. */
export function useAdminFeed(): AdminFeedValue {
  const value = useContext(FeedContext);
  if (!value) throw new Error('useAdminFeed must be used inside <FeedProvider>');
  return value;
}
