'use client';

import clsx from 'clsx';
import type { KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { Hall, MapVenue } from '@/lib/api-types';

/**
 * Схема зала (GET /public/branches/:slug/halls): места в координатах плана. Выбрать можно только
 * места, которые сервер вернул свободными для запрошенного времени (selectable); остальные — для
 * ориентира. Основной доступный способ выбора — список мест, схема дублирует его.
 */
export function HallPlan({
  hall,
  selectable,
  selectedId,
  onSelect,
}: {
  hall: Hall;
  selectable: ReadonlySet<string>;
  selectedId: string | null;
  onSelect: (venueId: string) => void;
}) {
  const t = useTranslations('Booking.map');
  const onKey = (event: KeyboardEvent<SVGGElement>, venue: MapVenue) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(venue.id);
    }
  };
  return (
    <figure className="rounded-card border border-earth-100 bg-cream-50 p-3">
      <figcaption className="mb-2 text-sm font-semibold text-earth-900">{hall.name}</figcaption>
      <svg
        viewBox={`0 0 ${hall.planWidth} ${hall.planHeight}`}
        className="h-auto w-full rounded-xl bg-earth-50"
        role="group"
        aria-label={t('aria', { hall: hall.name })}
      >
        {hall.background ? (
          <image href={hall.background.url} x={0} y={0} width={hall.planWidth} height={hall.planHeight} preserveAspectRatio="xMidYMid slice" opacity={0.35} />
        ) : null}
        {hall.venues.map((venue) => {
          const canSelect = selectable.has(venue.id);
          const selected = venue.id === selectedId;
          const { x, y, w, h, shape, rotation } = venue.position;
          const cx = x + w / 2;
          const cy = y + h / 2;
          const label = t(canSelect ? 'venueFree' : 'venueBusy', { name: venue.name, min: venue.capacityMin, max: venue.capacityMax });
          const fill = selected ? 'var(--color-gold-400)' : canSelect ? 'var(--color-steppe-100)' : 'var(--color-earth-100)';
          const stroke = selected ? 'var(--color-earth-900)' : canSelect ? 'var(--color-steppe-700)' : 'var(--color-earth-300)';
          return (
            <g
              key={venue.id}
              transform={rotation ? `rotate(${rotation} ${cx} ${cy})` : undefined}
              role={canSelect ? 'button' : 'img'}
              tabIndex={canSelect ? 0 : undefined}
              aria-label={label}
              aria-pressed={canSelect ? selected : undefined}
              onClick={canSelect ? () => onSelect(venue.id) : undefined}
              onKeyDown={canSelect ? (e) => onKey(e, venue) : undefined}
              className={clsx(canSelect ? 'cursor-pointer focus:outline-none [&:focus>*:first-child]:stroke-[4]' : 'cursor-not-allowed')}
            >
              <title>{label}</title>
              {shape === 'circle' ? (
                <ellipse cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={2} />
              ) : (
                <rect x={x} y={y} width={w} height={h} rx={Math.min(w, h) * 0.12} fill={fill} stroke={stroke} strokeWidth={2} />
              )}
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={Math.max(10, Math.min(w, h) * 0.22)}
                fill={canSelect || selected ? 'var(--color-earth-900)' : 'var(--color-earth-400)'}
                transform={rotation ? `rotate(${-rotation} ${cx} ${cy})` : undefined}
                pointerEvents="none"
              >
                {venue.name}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-steppe-700 bg-steppe-100" />
          {t('legendFree')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-earth-900 bg-gold-400" />
          {t('legendSelected')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-earth-300 bg-earth-100" />
          {t('legendBusy')}
        </span>
      </div>
    </figure>
  );
}
