import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';

/** Тайлы OSM; для production — свой или коммерческий тайл-сервер (VITE_MAP_TILES_URL). */
const TILES_URL = import.meta.env.VITE_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export interface GeoValue {
  lat: number;
  lng: number;
}

function ClickHandler({ onPick }: { onPick: (value: GeoValue) => void }) {
  useMapEvents({
    click(event) {
      onPick({ lat: Number(event.latlng.lat.toFixed(6)), lng: Number(event.latlng.lng.toFixed(6)) });
    },
  });
  return null;
}

/** Выбор точки на карте (OSM) — клик ставит координаты филиала. Загружается лениво. */
export default function MapPointPicker({ value, onChange }: { value?: GeoValue | null; onChange?: (value: GeoValue) => void }) {
  const center: [number, number] = value ? [value.lat, value.lng] : [51.1282, 71.4304];
  return (
    <MapContainer center={center} zoom={value ? 16 : 12} style={{ height: 320, width: '100%', borderRadius: 8 }} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url={TILES_URL} />
      {value ? <CircleMarker center={[value.lat, value.lng]} radius={10} pathOptions={{ color: '#57351e', fillColor: '#d9ae4f', fillOpacity: 0.9 }} /> : null}
      <ClickHandler onPick={(point) => onChange?.(point)} />
    </MapContainer>
  );
}
