/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес API; пусто — тот же origin (reverse proxy /api → API). */
  readonly VITE_API_URL?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Версия сборки (тег релиза) — для Sentry. */
  readonly VITE_RELEASE?: string;
  /** Шаблон URL тайлов карты (Leaflet), по умолчанию OpenStreetMap. */
  readonly VITE_MAP_TILES_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
