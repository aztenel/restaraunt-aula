import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { GeoPoint } from '@aula/api-client';
import { DEFAULT_MAP_CENTER, MAP_ATTRIBUTION, MAP_COLORS, MAP_TILES_URL } from '../common/map-config';
import type { PublicDeliveryZone } from '../types';

function ClickToPick({ onPick }: { onPick: (point: GeoPoint) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    },
  });
  return null;
}

/** Один раз подогнать карту под зоны филиала (или точку), когда они загрузились. */
function FitOnce({ zones, point }: { zones: readonly PublicDeliveryZone[]; point: GeoPoint | null }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    const points = [...zones.flatMap((z) => z.polygon), ...(point ? [point] : [])];
    if (points.length === 0) return;
    done.current = true;
    const lats = points.map((p) => p.lat);
    const lngs = points.map((p) => p.lng);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { padding: [24, 24], maxZoom: 15 },
    );
  }, [zones, point, map]);
  return null;
}

/**
 * Точка доставки для телефонного заказа: клик по карте ставит точку; видны филиал и его зоны
 * доставки (подсказка оператору — в какую зону попал адрес, решает сервер при расчёте).
 */
export default function AddressMap({
  value,
  onChange,
  branch,
  branchLabel,
  zones,
  activeZoneId,
  height = 320,
}: {
  value: GeoPoint | null;
  onChange: (point: GeoPoint) => void;
  branch: GeoPoint | null;
  branchLabel?: string;
  zones: readonly PublicDeliveryZone[];
  /** Зона, в которую попала точка по расчёту сервера. */
  activeZoneId?: string | null;
  height?: number;
}) {
  const center = value ?? branch ?? DEFAULT_MAP_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={13} style={{ height, width: '100%', borderRadius: 8 }} scrollWheelZoom>
      <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILES_URL} />
      {zones.map((zone) => (
        <Polygon
          key={zone.id}
          positions={zone.polygon.map((p) => [p.lat, p.lng] as [number, number])}
          pathOptions={{
            color: zone.id === activeZoneId ? MAP_COLORS.zoneSelected : MAP_COLORS.zone,
            weight: zone.id === activeZoneId ? 3 : 2,
            fillOpacity: zone.id === activeZoneId ? 0.25 : 0.1,
          }}
        >
          <Tooltip sticky>{zone.name}</Tooltip>
        </Polygon>
      ))}
      {branch ? (
        <CircleMarker center={[branch.lat, branch.lng]} radius={8} pathOptions={{ color: MAP_COLORS.branch, fillColor: MAP_COLORS.branchFill, fillOpacity: 0.9 }}>
          {branchLabel ? <Tooltip>{branchLabel}</Tooltip> : null}
        </CircleMarker>
      ) : null}
      {value ? (
        <CircleMarker center={[value.lat, value.lng]} radius={11} pathOptions={{ color: MAP_COLORS.point, fillColor: MAP_COLORS.point, fillOpacity: 0.55, weight: 3 }} />
      ) : null}
      <ClickToPick onPick={onChange} />
      <FitOnce zones={zones} point={value} />
    </MapContainer>
  );
}
