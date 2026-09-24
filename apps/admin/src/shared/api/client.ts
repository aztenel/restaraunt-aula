/**
 * Клиент AULA API для админки: Bearer-токен из памяти, язык интерфейса,
 * обновление сессии при 401 (один повтор запроса).
 */
import { call, createApiClient, type Session } from '@aula/api-client';
import { session } from '../auth/session';
import { currentLanguage } from '../i18n/language';

/** Корень API; пусто — тот же origin (в разработке — прокси Vite). */
export const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');

export const api = createApiClient({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  getAccessToken: () => session.getAccessToken(),
  getLocale: () => currentLanguage(),
  onUnauthorized: () => session.refresh(),
});

session.configure({
  refresh: async () => (await call(api.POST('/api/v1/admin/auth/refresh'))) as Session,
});
