'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Карта филиала (OpenStreetMap через react-leaflet). Загружается только в браузере
 * (ssr: false) и отдельным чанком — не влияет на скорость первой отрисовки страницы.
 */
const LeafletMap = dynamic(() => import('./BranchMapLeaflet'), {
  ssr: false,
  loading: () => <MapFallback />,
});

function MapFallback() {
  const t = useTranslations('Map');
  return (
    <div className="relative h-full w-full">
      <Skeleton className="h-full w-full rounded-none" />
      <span className="absolute inset-0 grid place-items-center text-sm text-muted">{t('loading')}</span>
    </div>
  );
}

export function BranchMap({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  return (
    <div className="h-72 w-full overflow-hidden rounded-card border border-earth-100 sm:h-96" role="region" aria-label={label}>
      <LeafletMap lat={lat} lng={lng} label={label} />
    </div>
  );
}
