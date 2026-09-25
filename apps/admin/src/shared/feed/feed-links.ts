/**
 * Куда ведёт событие ленты и что оно обновляет — чистые функции (тестируются без браузера).
 *  - клик по уведомлению: на саму сущность (заказ, бронь, банкетная заявка, задача, стоп-лист),
 *    без entityType или с неизвестным типом — на раздел очереди;
 *  - изменения стоп-листа (entityType dish, очередь orders) обновляют меню филиала и стоп-лист.
 */
import type { QueryKey } from '@tanstack/react-query';
import type { FeedEvent, FeedStream } from './types';

export const STREAM_PATHS: Record<FeedStream, string> = {
  orders: '/orders',
  reservations: '/reservations',
  banquets: '/banquets',
  system: '/system',
};

export interface FeedLinkOptions {
  /** У сотрудника есть право menu.stoplist хотя бы в одном филиале (иначе — меню филиала). */
  canStopList: boolean;
}

export function feedEntityPath(event: Pick<FeedEvent, 'stream' | 'entityType' | 'entityId'>, options: FeedLinkOptions): string {
  const id = encodeURIComponent(event.entityId);
  switch (event.entityType) {
    case 'order':
      return `/orders/${id}`;
    case 'reservation':
      return `/reservations?open=${id}`;
    case 'banquet_request':
      return `/banquets/${id}`;
    case 'failed_job':
      return '/system';
    case 'branch':
      return '/branches';
    case 'dish':
      return options.canStopList ? '/stop-list' : '/menu/branch';
    default:
      return STREAM_PATHS[event.stream] ?? '/';
  }
}

/**
 * Дополнительные запросы, которые нужно обновить по событиям (кроме корня очереди, см. feed-reducer):
 * изменение стоп-листа блюда → меню филиала и стоп-лист (['catalog', 'branch-menu', branchId]) и меню
 * телефонного заказа (['phone-order', 'menu', branchId]). Без филиала — во всех филиалах.
 */
export function feedQueryInvalidations(events: readonly unknown[]): QueryKey[] {
  const keys = new Map<string, QueryKey>();
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Partial<FeedEvent>;
    if (event.entityType !== 'dish') continue;
    const branchId = typeof event.branchId === 'string' ? event.branchId : null;
    const menu: QueryKey = branchId ? ['catalog', 'branch-menu', branchId] : ['catalog', 'branch-menu'];
    const phoneMenu: QueryKey = branchId ? ['phone-order', 'menu', branchId] : ['phone-order', 'menu'];
    keys.set(JSON.stringify(menu), menu);
    keys.set(JSON.stringify(phoneMenu), phoneMenu);
  }
  return [...keys.values()];
}
