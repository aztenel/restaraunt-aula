import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
// leaflet-geoman дополняет глобальный L (window.L выставляет leaflet) — импорт строго после leaflet.
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { useEffect, useRef } from 'react';
import { CircleMarker, MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { translate, type GeoPoint } from '@aula/api-client';
import { DEFAULT_MAP_CENTER, MAP_ATTRIBUTION, MAP_COLORS, MAP_TILES_URL } from '@/features/orders/common/map-config';
import { latLngsToPolygon, polygonToLatLngs, type DeliveryZone } from './zone-form';

const DRAW_STYLE = { color: MAP_COLORS.zoneSelected, weight: 3, fillOpacity: 0.2 };

export interface DrawTooltips {
  firstVertex: string;
  continueLine: string;
  finishPoly: string;
}

/** Режим рисования новой зоны (leaflet-geoman): готовый полигон отдаётся наружу, слой убирается. */
function DrawController({ drawing, tooltips, onDrawn }: { drawing: boolean; tooltips: DrawTooltips; onDrawn: (polygon: GeoPoint[]) => void }) {
  const map = useMap();
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;

  const { firstVertex, continueLine, finishPoly } = tooltips;
  useEffect(() => {
    // Казахского в geoman нет: подсказки рисования — из словарей админки (ru/kk).
    map.pm.setLang('ru', { tooltips: { firstVertex, continueLine, finishPoly } }, 'ru');
    map.pm.setGlobalOptions({
      allowSelfIntersection: false,
      snappable: true,
      snapDistance: 12,
      pathOptions: DRAW_STYLE,
      templineStyle: DRAW_STYLE,
      hintlineStyle: { ...DRAW_STYLE, dashArray: '5,5' },
    });
  }, [map, firstVertex, continueLine, finishPoly]);

  useEffect(() => {
    if (!drawing) return;
    const onCreate = (event: { layer: L.Layer }) => {
      const layer = event.layer as L.Polygon;
      const polygon = latLngsToPolygon(layer.getLatLngs());
      layer.remove();
      onDrawnRef.current(polygon);
    };
    map.on('pm:create', onCreate);
    map.pm.enableDraw('Polygon', { allowSelfIntersection: false, snappable: true });
    return () => {
      map.off('pm:create', onCreate);
      map.pm.disableDraw();
    };
  }, [map, drawing]);
  return null;
}

/**
 * Редактируемый полигон выбранной зоны: вершины перетаскиваются, середина стороны добавляет вершину,
 * правый клик по вершине удаляет. Слой пересоздаётся только при смене resetKey (выбор зоны, откат,
 * сохранение) — иначе правки на карте не сбрасываются при каждом рендере.
 */
function EditablePolygon({ polygon, resetKey, conflict, onChange }: { polygon: GeoPoint[]; resetKey: string; conflict: boolean; onChange: (polygon: GeoPoint[]) => void }) {
  const map = useMap();
  const layerRef = useRef<L.Polygon | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const polygonRef = useRef(polygon);
  polygonRef.current = polygon;

  useEffect(() => {
    if (polygonRef.current.length < 3) return;
    const layer = L.polygon(polygonToLatLngs(polygonRef.current), { ...DRAW_STYLE, fillOpacity: 0.25 });
    layer.addTo(map);
    layer.pm.enable({ allowSelfIntersection: false, snappable: true });
    const emit = () => onChangeRef.current(latLngsToPolygon(layer.getLatLngs()));
    layer.on('pm:edit', emit);
    layerRef.current = layer;
    return () => {
      layer.off('pm:edit', emit);
      layer.pm.disable();
      layer.remove();
      layerRef.current = null;
    };
  }, [map, resetKey]);

  useEffect(() => {
    layerRef.current?.setStyle(conflict ? { color: MAP_COLORS.zoneConflict, dashArray: '6,4' } : { color: MAP_COLORS.zoneSelected, dashArray: undefined });
  }, [conflict, resetKey]);
  return null;
}

/** Подогнать карту под зоны и филиал при первой загрузке зон филиала. */
function FitToZones({ zones, branch }: { zones: readonly DeliveryZone[]; branch: GeoPoint | null }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current) return;
    const points = [...zones.flatMap((z) => z.polygon), ...(branch ? [branch] : [])];
    if (points.length === 0) return;
    fitted.current = true;
    if (points.length === 1) {
      map.setView([points[0]!.lat, points[0]!.lng], 13);
      return;
    }
    map.fitBounds(
      [
        [Math.min(...points.map((p) => p.lat)), Math.min(...points.map((p) => p.lng))],
        [Math.max(...points.map((p) => p.lat)), Math.max(...points.map((p) => p.lng))],
      ],
      { padding: [32, 32], maxZoom: 14 },
    );
  }, [zones, branch, map]);
  return null;
}

export interface ZonesMapProps {
  zones: readonly DeliveryZone[];
  branch: GeoPoint | null;
  branchLabel: string;
  /** Выбранная зона (её рисует редактируемый полигон), 'new' — новая зона. */
  selectedId: string | null;
  draft: GeoPoint[];
  resetKey: string;
  drawing: boolean;
  /** Зона, с которой сервер нашёл пересечение (подсвечивается). */
  conflictId: string | null;
  /** Язык подписей зон. */
  language: string;
  tooltips: DrawTooltips;
  height: number;
  onSelect: (id: string) => void;
  onDraftChange: (polygon: GeoPoint[]) => void;
  onDrawn: (polygon: GeoPoint[]) => void;
}

/** Карта зон доставки филиала: OSM-тайлы, маркер филиала, полигоны зон, рисование и правка (leaflet-geoman). */
export default function ZonesMap({
  zones,
  branch,
  branchLabel,
  selectedId,
  draft,
  resetKey,
  drawing,
  conflictId,
  language,
  tooltips,
  height,
  onSelect,
  onDraftChange,
  onDrawn,
}: ZonesMapProps) {
  const center = branch ?? DEFAULT_MAP_CENTER;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={12} style={{ height, width: '100%', borderRadius: 8 }} scrollWheelZoom>
      <TileLayer attribution={MAP_ATTRIBUTION} url={MAP_TILES_URL} />
      {zones
        .filter((zone) => zone.id !== selectedId)
        .map((zone) => {
          const conflict = zone.id === conflictId;
          const color = conflict ? MAP_COLORS.zoneConflict : zone.isActive ? MAP_COLORS.zone : MAP_COLORS.zoneInactive;
          return (
            <Polygon
              key={`${zone.id}:${conflict}`}
              positions={polygonToLatLngs(zone.polygon)}
              pathOptions={{
                color,
                weight: conflict ? 4 : 2,
                fillOpacity: conflict ? 0.35 : zone.isActive ? 0.15 : 0.06,
                dashArray: zone.isActive ? undefined : '6,6',
              }}
              eventHandlers={{ click: () => (drawing ? undefined : onSelect(zone.id)) }}
            >
              <Tooltip sticky>{translate(zone.name, language) || zone.id}</Tooltip>
            </Polygon>
          );
        })}
      {branch ? (
        <CircleMarker center={[branch.lat, branch.lng]} radius={9} pathOptions={{ color: MAP_COLORS.branch, fillColor: MAP_COLORS.branchFill, fillOpacity: 0.95, weight: 3 }}>
          <Tooltip permanent direction="top" offset={[0, -8]}>
            {branchLabel}
          </Tooltip>
        </CircleMarker>
      ) : null}
      {selectedId && draft.length >= 3 ? (
        <EditablePolygon polygon={draft} resetKey={resetKey} conflict={conflictId !== null} onChange={onDraftChange} />
      ) : null}
      <DrawController drawing={drawing} tooltips={tooltips} onDrawn={onDrawn} />
      <FitToZones zones={zones} branch={branch} />
    </MapContainer>
  );
}
