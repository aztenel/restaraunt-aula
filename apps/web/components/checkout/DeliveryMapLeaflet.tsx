'use client';

import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useEffect } from 'react';
import { MapContainer, Marker, Polygon, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { DeliveryZone, GeoPoint } from '@/lib/api-types';

const TILES_URL = process.env.NEXT_PUBLIC_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const pinIcon = L.divIcon({
  className: '',
  iconSize: [36, 46],
  iconAnchor: [18, 44],
  html: `<svg width="36" height="46" viewBox="0 0 36 46" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M18 45s15-14.2 15-26A15 15 0 0 0 3 19c0 11.8 15 26 15 26Z" fill="#b5452c" stroke="#fffcf7" stroke-width="2"/>
    <circle cx="18" cy="19" r="6" fill="#fffcf7"/></svg>`,
});

function ClickToPlace({ onPick }: { onPick: (point: GeoPoint) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: event.latlng.lat, lng: event.latlng.lng });
    },
  });
  return null;
}

/** Центрировать карту на точке, когда её выбрали поиском или геолокацией. */
function FollowPoint({ point }: { point: GeoPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.setView([point.lat, point.lng], Math.max(map.getZoom(), 16), { animate: true });
  }, [map, point]);
  return null;
}

export default function DeliveryMapLeaflet({
  center,
  point,
  zones,
  onPick,
  markerLabel,
}: {
  center: GeoPoint;
  point: GeoPoint | null;
  zones: DeliveryZone[];
  onPick: (point: GeoPoint) => void;
  markerLabel: string;
}) {
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={12} scrollWheelZoom={false} className="h-full w-full" attributionControl>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url={TILES_URL} maxZoom={19} />
      {zones.map((zone) => (
        <Polygon
          key={zone.id}
          positions={zone.polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: '#57351e', weight: 1.5, fillColor: '#d9ae4f', fillOpacity: 0.12 }}
        />
      ))}
      {point ? (
        <Marker
          position={[point.lat, point.lng]}
          icon={pinIcon}
          draggable
          title={markerLabel}
          alt={markerLabel}
          keyboard
          eventHandlers={{
            dragend(event) {
              const latlng = (event.target as L.Marker).getLatLng();
              onPick({ lat: latlng.lat, lng: latlng.lng });
            },
          }}
        />
      ) : null}
      <ClickToPlace onPick={onPick} />
      <FollowPoint point={point} />
    </MapContainer>
  );
}
