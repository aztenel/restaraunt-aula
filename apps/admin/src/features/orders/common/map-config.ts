/** Карта (Leaflet): тайлы OSM или свой тайл-сервер (VITE_MAP_TILES_URL), центр по умолчанию — Астана. */
export const MAP_TILES_URL = import.meta.env.VITE_MAP_TILES_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

export const DEFAULT_MAP_CENTER = { lat: 51.1282, lng: 71.4304 };

/** Цвета на карте: филиал, точка доставки, зоны (активная/выключенная/выбранная/конфликт). */
export const MAP_COLORS = {
  branch: '#57351e',
  branchFill: '#d9ae4f',
  point: '#b5452c',
  zone: '#8a5a36',
  zoneInactive: '#9e9e9e',
  zoneSelected: '#1d6fb8',
  zoneConflict: '#d4380d',
} as const;
