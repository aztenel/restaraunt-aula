'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import type { DeliveryZone, GeoPoint } from '@/lib/api-types';

/** Карта выбора точки доставки: грузится только в браузере, отдельным чанком (не мешает первому экрану). */
const LeafletMap = dynamic(() => import('./DeliveryMapLeaflet'), {
  ssr: false,
  loading: () => <MapFallback />,
});

function MapFallback() {
  const t = useTranslations('Map');
  return (
    <div className="relative h-full w-full">
      <Skeleton className="h-full w-full" rounded="none" />
      <span className="absolute inset-0 grid place-items-center text-sm text-muted">{t('loading')}</span>
    </div>
  );
}

export function DeliveryMap(props: { center: GeoPoint; point: GeoPoint | null; zones: DeliveryZone[]; onPick: (point: GeoPoint) => void; label: string }) {
  return (
    <div className="h-64 w-full overflow-hidden rounded-card border border-earth-100 sm:h-80" role="region" aria-label={props.label}>
      <LeafletMap center={props.center} point={props.point} zones={props.zones} onPick={props.onPick} markerLabel={props.label} />
    </div>
  );
}
