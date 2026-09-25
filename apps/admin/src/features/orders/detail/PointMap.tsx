import 'leaflet/dist/leaflet.css';
import { CircleMarker, MapContainer, TileLayer, Tooltip } from 'react-leaflet';
import type { GeoPoint } from '@aula/api-client';
import { MAP_ATTRIBUTION, MAP_COLORS, MAP_TILES_URL } from '../common/map-config';

/** Точка доставки (и филиал) на карте — только просмотр. Загружается лениво (Leaflet — отдельный чанк). */
export default function PointMap({
  point,
  branch,
  pointLabel,
  branchLabel,
  height = 220,
}: {
  point: GeoPoint;
  branch?: GeoPoint | null;
  pointLabel?: string;
  branchLabel?: string;
  height?: number;
}) {
  const bounds: [[number, number], [number, number]] | undefined = branch
    ? [
        [Math.min(point.lat, branch.lat), Math.min(point.lng, branch.lng)],
        [Math.max(point.lat, branch.lat), Math.max(point.lng, branch.lng)],
      ]
    : undefined;
  return (
    <MapContainer
      {...(bounds ? { bounds, boundsOptions: { padding: [32, 32] } } : { center: [point.lat, point.lng], zoom: 15 })}
      style={{ height, width: '100%', borderRadius: 8 }}
      scrollWheelZoom={false}
    >
      <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILES_URL} />
      {branch ? (
        <CircleMarker center={[branch.lat, branch.lng]} radius={8} pathOptions={{ color: MAP_COLORS.branch, fillColor: MAP_COLORS.branchFill, fillOpacity: 0.9 }}>
          {branchLabel ? <Tooltip>{branchLabel}</Tooltip> : null}
        </CircleMarker>
      ) : null}
      <CircleMarker center={[point.lat, point.lng]} radius={10} pathOptions={{ color: MAP_COLORS.point, fillColor: MAP_COLORS.point, fillOpacity: 0.6 }}>
        {pointLabel ? <Tooltip permanent={false}>{pointLabel}</Tooltip> : null}
      </CircleMarker>
    </MapContainer>
  );
}
