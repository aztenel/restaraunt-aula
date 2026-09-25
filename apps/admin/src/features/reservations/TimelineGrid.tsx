/**
 * Шахматка дня: строки — места (по залам), шкала — часы работы филиала. Брони и банкеты — плашки
 * по времени, буфер уборки — штриховка после брони, нерабочее время — затемнение, линия «сейчас».
 * Клик по плашке — карточка брони, по свободному месту дорожки — новая бронь на это время.
 */
import { Tag, Tooltip, Typography } from 'antd';
import { Fragment, useMemo, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, translate } from '@aula/api-client';
import { tx } from '@/shared/i18n/tx';
import { formatTimeRange, venueTitle } from './format';
import { timelineHold } from './hold-countdown';
import { itemSwatch } from './palette';
import { HoldCountdownTag } from './parts';
import {
  assignLanes,
  closedSegments,
  hourTicks,
  itemGeometry,
  nowOffset,
  timeAtFraction,
  timelineWindow,
  type TimeWindow,
} from './timeline-layout';
import type { Timeline, TimelineHall, TimelineItem, TimelineVenue } from './types';

const LANE_HEIGHT = 32;
const PX_PER_HOUR = 76;
const LABEL_WIDTH = 200;

export interface TimelineGridProps {
  timeline: Timeline;
  halls: TimelineHall[];
  now: number;
  highlightIds: ReadonlySet<string>;
  onItemClick: (item: TimelineItem) => void;
  /** Клик по свободному времени места; null — создание броней недоступно. */
  onSlotClick: ((venue: TimelineVenue, at: number) => void) | null;
}

export function TimelineGrid({ timeline, halls, now, highlightIds, onItemClick, onSlotClick }: TimelineGridProps) {
  const { t, i18n } = useTranslation();
  const tz = timeline.timezone;
  const window = useMemo(
    () =>
      timelineWindow({
        from: timeline.from,
        to: timeline.to,
        openingRanges: timeline.openingRanges,
        items: timeline.halls.flatMap((h) => h.venues.flatMap((v) => v.items)),
        timezone: tz,
      }),
    [timeline, tz],
  );
  const ticks = useMemo(() => hourTicks(window, tz), [window, tz]);
  const closed = useMemo(() => closedSegments(window, timeline.openingRanges), [window, timeline.openingRanges]);
  const nowLeft = nowOffset(now, window);
  const hours = (window.end - window.start) / 3_600_000;
  const minWidth = LABEL_WIDTH + Math.max(6, hours) * PX_PER_HOUR;

  return (
    <div className="rsv-tl" style={{ ['--rsv-label-w' as string]: `${LABEL_WIDTH}px`, ['--rsv-lane-h' as string]: `${LANE_HEIGHT}px` }}>
      <div className="rsv-tl-scroll">
        <div style={{ minWidth }}>
          <div className="rsv-tl-row rsv-tl-header">
            <div className="rsv-tl-label">
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('reservations.fields.venue')}
              </Typography.Text>
            </div>
            <div className="rsv-tl-track">
              {ticks.map((tick) => (
                <span key={tick.at} className="rsv-tl-tick-label" style={{ left: `${tick.left}%` }}>
                  {tick.label}
                </span>
              ))}
            </div>
          </div>
          {halls.map((hall) => (
            <Fragment key={hall.id}>
              <div className="rsv-tl-hall">
                <span className="rsv-tl-hall-inner">
                  {translate(hall.name, i18n.language) || hall.code}
                  {!hall.isActive ? (
                    <Tag style={{ marginInlineStart: 8 }}>{t('reservations.inactive')}</Tag>
                  ) : null}
                </span>
              </div>
              {hall.venues.map((venue) => (
                <VenueRow
                  key={venue.id}
                  venue={venue}
                  hallActive={hall.isActive}
                  window={window}
                  tz={tz}
                  ticks={ticks.map((tick) => tick.left)}
                  closed={closed}
                  nowLeft={nowLeft}
                  now={now}
                  highlightIds={highlightIds}
                  onItemClick={onItemClick}
                  onSlotClick={onSlotClick}
                />
              ))}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function VenueRow({
  venue,
  hallActive,
  window,
  tz,
  ticks,
  closed,
  nowLeft,
  now,
  highlightIds,
  onItemClick,
  onSlotClick,
}: {
  venue: TimelineVenue;
  hallActive: boolean;
  window: TimeWindow;
  tz: string;
  ticks: number[];
  closed: ReturnType<typeof closedSegments>;
  nowLeft: number | null;
  now: number;
  highlightIds: ReadonlySet<string>;
  onItemClick: (item: TimelineItem) => void;
  onSlotClick: ((venue: TimelineVenue, at: number) => void) | null;
}) {
  const { t, i18n } = useTranslation();
  const active = venue.isActive && hallActive;
  const { lanes, count } = useMemo(
    () => assignLanes(venue.items.map((item) => ({ id: item.reservationId, start: item.start, blockedUntil: item.blockedUntil }))),
    [venue.items],
  );
  const canBook = Boolean(onSlotClick) && active;

  const onTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!canBook || !onSlotClick) return;
    const target = event.target as HTMLElement;
    if (target.closest('.rsv-tl-item')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - rect.left) / rect.width;
    // Шаг сетки — по правилу места (slotStepMinutes), как предлагает время витрина.
    onSlotClick(venue, timeAtFraction(fraction, window, venue.rules.slotStepMinutes || 15));
  };

  const meta = [
    t('reservations.capacityRange', { min: venue.capacityMin, max: venue.capacityMax }),
    venue.deposit ? formatMoney(venue.deposit, i18n.language) : null,
    translate(venue.typeName, i18n.language),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`rsv-tl-row${active ? '' : ' rsv-tl-inactive'}`} style={{ minHeight: count * LANE_HEIGHT + 4 }}>
      <div className="rsv-tl-label">
        <div className="rsv-tl-label-name" title={venueTitle(venue, i18n.language)}>
          {venueTitle(venue, i18n.language)}
        </div>
        <div className="rsv-tl-label-meta" title={meta}>
          {!active ? `${t('reservations.inactive')} · ` : !venue.bookableOnline ? `${t('reservations.phoneOnly')} · ` : ''}
          {meta}
        </div>
      </div>
      <div
        className={`rsv-tl-track${canBook ? '' : ' rsv-readonly'}`}
        onClick={onTrackClick}
        title={canBook ? t('reservations.day.clickHint') : undefined}
      >
        {closed.map((segment) => (
          <div key={`c${segment.left}`} className="rsv-tl-closed" style={{ left: `${segment.left}%`, width: `${segment.width}%` }} />
        ))}
        {ticks.map((left) => (
          <div key={`g${left}`} className="rsv-tl-gridline" style={{ left: `${left}%` }} />
        ))}
        {nowLeft !== null ? <div className="rsv-tl-now" style={{ left: `${nowLeft}%` }} /> : null}
        {venue.items.map((item) => (
          <ItemBar
            key={item.reservationId}
            item={item}
            lane={lanes.get(item.reservationId) ?? 0}
            window={window}
            tz={tz}
            now={now}
            highlight={highlightIds.has(item.reservationId)}
            onClick={onItemClick}
          />
        ))}
      </div>
    </div>
  );
}

function ItemBar({
  item,
  lane,
  window,
  tz,
  now,
  highlight,
  onClick,
}: {
  item: TimelineItem;
  lane: number;
  window: TimeWindow;
  tz: string;
  now: number;
  highlight: boolean;
  onClick: (item: TimelineItem) => void;
}) {
  const { t } = useTranslation();
  const geometry = itemGeometry(item, window);
  if (!geometry.main && !geometry.buffer) return null;
  const swatch = itemSwatch(item.kind, item.status);
  const top = lane * LANE_HEIGHT + 3;
  const banquet = item.kind === 'banquet';
  const who = banquet ? t('reservations.kinds.banquet') : item.customerName || item.customerPhone || item.number;
  const hold = timelineHold(item, now);
  const holdText = hold
    ? hold.urgency === 'expired'
      ? t('reservations.queue.expired')
      : t('reservations.day.holdLeft', { minutes: hold.minutes })
    : null;
  const label = `${formatTimeRange(item.start, item.end, tz)} · ${t('reservations.guestsCount', { count: item.guests })} · ${who}`;
  const tooltip = (
    <div>
      <div>
        <strong>{item.number}</strong> · {banquet ? t('reservations.kinds.banquet') : tx(t, `statuses.reservation.${item.status}`, item.status)}
      </div>
      <div>{label}</div>
      {item.customerPhone ? <div>{item.customerPhone}</div> : null}
      {item.depositState !== 'none' ? (
        <div>
          {t('reservations.fields.deposit')}: {tx(t, `reservations.depositStates.${item.depositState}`, item.depositState)}
        </div>
      ) : null}
      {item.needsMark ? <div>{t('reservations.needsMark')}</div> : null}
      {hold ? (
        <div>
          <HoldCountdownTag holdExpiresAt={item.holdExpiresAt} />
        </div>
      ) : null}
      {geometry.main?.clippedStart ? <div>{t('reservations.day.fromPrevDay')}</div> : null}
      {geometry.main?.clippedEnd ? <div>{t('reservations.day.toNextDay')}</div> : null}
    </div>
  );
  const classes = [
    'rsv-tl-item',
    banquet ? 'rsv-banquet' : '',
    swatch.dashed ? 'rsv-dashed' : '',
    geometry.main?.clippedStart ? 'rsv-clip-start' : '',
    geometry.main?.clippedEnd ? 'rsv-clip-end' : '',
    highlight ? 'rsv-new' : '',
    hold && (hold.urgency === 'critical' || hold.urgency === 'expired') ? 'rsv-hold-critical' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <>
      {geometry.buffer ? (
        <div
          className="rsv-tl-buffer"
          style={{ left: `${geometry.buffer.left}%`, width: `${geometry.buffer.width}%`, top }}
          aria-hidden
        />
      ) : null}
      {geometry.main ? (
        <Tooltip title={tooltip} mouseEnterDelay={0.3}>
          <button
            type="button"
            className={classes}
            style={{
              left: `${geometry.main.left}%`,
              width: `${geometry.main.width}%`,
              top,
              background: swatch.fill,
              borderColor: swatch.stroke,
              color: swatch.text,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onClick(item);
            }}
            aria-label={`${item.number}: ${label}${holdText ? ` · ${holdText}` : ''}`}
          >
            {item.needsMark ? <span className="rsv-mark-dot" aria-hidden /> : null}
            {holdText ? <span className="rsv-hold-badge">⏱ {holdText}</span> : null}
            {label}
          </button>
        </Tooltip>
      ) : null}
    </>
  );
}
