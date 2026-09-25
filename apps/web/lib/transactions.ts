/**
 * Серверные запросы страниц по публичным токенам (заказ, бронь, смета и счёт банкета) — без кэша:
 * статусы меняются. null — токен не найден (HTTP 404 витрины); прочие ошибки пробрасываются.
 * Справочник типов мероприятий кэшируется.
 */
import { cache } from 'react';
import { ApiError, call } from '@aula/api-client';
import type { AppLocale } from '@/i18n/routing';
import { createServerApi } from './api';
import type { BanquetEventType, BanquetInvoice, BanquetQuote, OrderTracking, Reservation } from './api-types';

async function notFoundAsNull<T>(promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return null;
    throw error;
  }
}

export async function getOrderTracking(locale: AppLocale, token: string): Promise<OrderTracking | null> {
  const api = createServerApi({ locale, revalidate: false });
  return notFoundAsNull(call(api.GET('/api/v1/public/orders/{publicToken}', { params: { path: { publicToken: token }, query: { locale } } })));
}

export async function getReservation(locale: AppLocale, token: string): Promise<Reservation | null> {
  const api = createServerApi({ locale, revalidate: false });
  return notFoundAsNull(call(api.GET('/api/v1/public/reservations/{token}', { params: { path: { token }, query: { locale } } })));
}

export async function getBanquetQuote(locale: AppLocale, token: string): Promise<BanquetQuote | null> {
  const api = createServerApi({ locale, revalidate: false });
  return notFoundAsNull(call(api.GET('/api/v1/public/banquets/quotes/{token}', { params: { path: { token }, query: { locale } } })));
}

export async function getBanquetInvoice(locale: AppLocale, token: string): Promise<BanquetInvoice | null> {
  const api = createServerApi({ locale, revalidate: false });
  return notFoundAsNull(call(api.GET('/api/v1/public/banquets/invoices/{token}', { params: { path: { token } } })));
}

/** Типы мероприятий (справочник API). Ошибка — пустой список (форма покажет запасной вариант). */
export const getBanquetEventTypes = cache(async (locale: AppLocale): Promise<BanquetEventType[]> => {
  try {
    const api = createServerApi({ locale, revalidate: 3600, tags: ['banquet-event-types'] });
    return await call(api.GET('/api/v1/public/banquets/event-types', { params: { query: { locale } } }));
  } catch (error) {
    console.warn('[banquets] event types unavailable:', error instanceof Error ? error.message : error);
    return [];
  }
});
