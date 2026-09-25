/**
 * Брони (reservations.view): день по местам — главный экран оператора, карта зала, список с фильтрами,
 * очереди (ждут подтверждения / депозит / отметки). Карточка брони открывается поверх любого вида
 * (?open=<id>, ссылка из уведомлений /reservations/<id>), бронь по телефону — reservations.manage в филиале.
 * Новые брони из ленты событий (в т.ч. оплаченный депозит у места с ручным подтверждением — событие «создана»):
 * звук (FeedProvider), счётчик и подсветка до просмотра.
 */
import { PlusOutlined } from '@ant-design/icons';
import { App, Badge, Button, Tabs } from 'antd';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { BookingDrawer } from './BookingDrawer';
import { DayView } from './DayView';
import { HallMapView } from './HallMapView';
import {
  ReservationsUiContext,
  useBranchTimezone,
  useNewReservations,
  type BookingPrefill,
  type ReservationsUi,
} from './hooks';
import { QueueView, useReservationQueues } from './QueueView';
import { ReservationDrawer } from './ReservationDrawer';
import { ReservationListView } from './ReservationListView';
import './reservations.css';

type ReservationsTab = 'day' | 'map' | 'list' | 'queue';
const TABS: ReservationsTab[] = ['day', 'map', 'list', 'queue'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ReservationsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { selectedBranchId } = useBranch();
  const { can } = useCan();
  const tz = useBranchTimezone(selectedBranchId);
  const news = useNewReservations();
  const queues = useReservationQueues(selectedBranchId);
  const [booking, setBooking] = useState<BookingPrefill | null>(null);

  const segment = location.pathname.replace(/^\/reservations\/?/, '').split('/')[0] as ReservationsTab | '';
  const activeTab: ReservationsTab = TABS.includes(segment as ReservationsTab) ? (segment as ReservationsTab) : 'day';
  const openId = params.get('open');
  const canCreate = Boolean(selectedBranchId) && can(Permission.ReservationsManage, selectedBranchId);

  const openReservation = useCallback(
    (id: string) =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('open', id);
        return next;
      }),
    [setParams],
  );
  const closeReservation = useCallback(
    () =>
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('open');
        return next;
      }),
    [setParams],
  );

  const ui = useMemo<ReservationsUi>(
    () => ({
      openReservation,
      openBooking: (prefill) => setBooking(prefill ?? {}),
      canCreate,
      newIds: news.newIds,
      acknowledge: news.acknowledge,
    }),
    [openReservation, canCreate, news.newIds, news.acknowledge],
  );

  const holdCount = (queues.pending.data?.total ?? 0) + (queues.awaiting_deposit.data?.total ?? 0);
  const markCount = queues.needs_mark.data?.total ?? 0;

  return (
    <ReservationsUiContext.Provider value={ui}>
      <PageHeader
        title={t('nav.reservations')}
        subtitle={t('sections.reservations')}
        extra={
          <>
            {news.count > 0 ? (
              <Button onClick={news.acknowledgeAll}>
                <Badge count={news.count} size="small" offset={[6, -2]}>
                  {t('reservations.markAllSeen')}
                </Badge>
              </Button>
            ) : null}
            {canCreate ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setBooking({})}>
                {t('reservations.newBooking')}
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => navigate({ pathname: `/reservations/${key}`, search: location.search })}
        style={{ marginBottom: 8 }}
        items={TABS.map((key) => ({
          key,
          label:
            key === 'queue' ? (
              <span>
                {t('reservations.tabs.queue')}{' '}
                <Badge count={holdCount} size="small" color="#d97706" />{' '}
                {markCount > 0 ? <Badge count={markCount} size="small" color="#cf1322" /> : null}
              </span>
            ) : (
              t(`reservations.tabs.${key}`)
            ),
        }))}
      />
      <Routes>
        <Route index element={<Navigate to={{ pathname: 'day', search: location.search }} replace />} />
        <Route path="day" element={<DayView />} />
        <Route path="map" element={<HallMapView />} />
        <Route path="list" element={<ReservationListView />} />
        <Route path="queue" element={<QueueView queues={queues} />} />
        <Route path=":id" element={<OpenFromLink />} />
      </Routes>
      <ReservationDrawer id={openId} onClose={closeReservation} onViewed={news.acknowledge} />
      {selectedBranchId ? (
        <BookingDrawer
          open={booking !== null}
          branchId={selectedBranchId}
          tz={tz}
          prefill={booking ?? EMPTY_PREFILL}
          onClose={() => setBooking(null)}
          onCreated={(created) => {
            setBooking(null);
            void message.success(t('reservations.booking.created', { number: created.number }));
            openReservation(created.id);
          }}
        />
      ) : null}
    </ReservationsUiContext.Provider>
  );
}

const EMPTY_PREFILL: BookingPrefill = {};

/** Ссылка из уведомления персоналу: /reservations/<id> → день с открытой карточкой. */
function OpenFromLink() {
  const { id } = useParams();
  if (!id || !UUID_RE.test(id)) return <NotFoundPage />;
  return <Navigate to={`/reservations/day?open=${encodeURIComponent(id)}`} replace />;
}
