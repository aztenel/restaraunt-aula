/**
 * Геокодирование адреса доставки — В БРАУЗЕРЕ (сервер принимает только точку на карте:
 * POST /public/delivery/resolve). Сервис совместим с Nominatim (/search, /reverse, format=jsonv2);
 * адрес — NEXT_PUBLIC_GEOCODER_URL (свой Nominatim или провайдер с таким же API). Не задан или
 * недоступен — гость ставит точку на карте вручную, адрес вводит текстом.
 * Запросы — только по явному действию гостя (кнопка «Найти», выбор точки), не на каждую букву:
 * условия публичного Nominatim — не чаще 1 запроса в секунду.
 */
import type { GeoPoint } from './api-types';

export interface GeocodeResult {
  point: GeoPoint;
  /** Короткий адрес для поля («ул. Кенесары, 40»). */
  label: string;
  /** Полный адрес (подсказка). */
  fullLabel: string;
}

/** Область поиска по умолчанию — Астана (lon_min, lat_max, lon_max, lat_min). */
export const DEFAULT_VIEWBOX = '71.20,51.30,71.75,50.98';
/** Центр карты по умолчанию — Астана. */
export const DEFAULT_CENTER: GeoPoint = { lat: 51.1282, lng: 71.4304 };

export function geocoderBaseUrl(): string | null {
  const raw = (process.env.NEXT_PUBLIC_GEOCODER_URL ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(raw) ? raw : null;
}

interface NominatimAddress {
  road?: string;
  pedestrian?: string;
  house_number?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
}

interface NominatimItem {
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
}

/** Ответ Nominatim → результат: координаты числами, короткая подпись «улица, дом». */
export function toGeocodeResult(item: NominatimItem): GeocodeResult | null {
  const lat = Number(item.lat);
  const lng = Number(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const full = (item.display_name ?? '').trim();
  const a = item.address ?? {};
  const street = a.road ?? a.pedestrian;
  const short = street ? [street, a.house_number].filter(Boolean).join(', ') : item.name || full.split(',').slice(0, 2).join(',').trim();
  return { point: { lat, lng }, label: short || full, fullLabel: full || short };
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' }, credentials: 'omit' });
  if (!response.ok) throw new Error(`Geocoder HTTP ${response.status}`);
  return response.json();
}

/** Поиск адреса (до 5 вариантов). Не настроен/ошибка — пустой список (витрина предложит поставить точку). */
export async function searchAddress(query: string, options: { locale: string; signal?: AbortSignal; baseUrl?: string | null } = { locale: 'ru' }): Promise<GeocodeResult[]> {
  const base = options.baseUrl === undefined ? geocoderBaseUrl() : options.baseUrl;
  const q = query.trim();
  if (!base || q.length < 3) return [];
  const params = new URLSearchParams({
    q,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '5',
    countrycodes: 'kz',
    viewbox: DEFAULT_VIEWBOX,
    bounded: '1',
    'accept-language': options.locale,
  });
  const data = await fetchJson(`${base}/search?${params}`, options.signal);
  return Array.isArray(data) ? data.map((item) => toGeocodeResult(item as NominatimItem)).filter((r): r is GeocodeResult => r !== null) : [];
}

/** Адрес по точке на карте; null — не найден или геокодер не настроен. */
export async function reverseGeocode(point: GeoPoint, options: { locale: string; signal?: AbortSignal; baseUrl?: string | null } = { locale: 'ru' }): Promise<GeocodeResult | null> {
  const base = options.baseUrl === undefined ? geocoderBaseUrl() : options.baseUrl;
  if (!base) return null;
  const params = new URLSearchParams({
    lat: String(point.lat),
    lon: String(point.lng),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
    'accept-language': options.locale,
  });
  const data = await fetchJson(`${base}/reverse?${params}`, options.signal);
  return data && typeof data === 'object' ? toGeocodeResult(data as NominatimItem) : null;
}
