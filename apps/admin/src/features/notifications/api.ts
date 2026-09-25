/**
 * Уведомления (модуль Notifications): шаблоны по каналам и языкам (integrations.manage или content.manage),
 * журнал доставки, повторная и тестовая отправка, состояние каналов (integrations.manage).
 * Типы — из сгенерированной схемы. Возвращают данные или бросают ApiError.
 */
import { call, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type { NotificationChannel } from './template-vars';

export type NotificationTemplate = Schemas['NotificationTemplateDto'];
export type TemplateText = Schemas['TemplateTextDto'];
export type TemplatePreview = Schemas['TemplatePreviewDto'];
export type ResolvedTemplateText = Schemas['ResolvedTemplateTextDto'];
export type DeliveryLogItem = Schemas['DeliveryLogItemDto'];
export type DeliveryDetail = Schemas['DeliveryDetailDto'];
export type ChannelStatus = Schemas['ChannelStatusDto'];
export type TemplateKey = NotificationTemplate['key'];
export type TemplateLocale = 'kk' | 'ru' | 'en';
export type DeliveryStatus = DeliveryLogItem['status'];

export const DELIVERY_STATUSES = ['pending', 'sent', 'failed'] as const;
export const TEMPLATE_LOCALES: TemplateLocale[] = ['ru', 'kk', 'en'];

export interface DeliveryLogQuery {
  status?: DeliveryStatus;
  channel?: NotificationChannel;
  template?: TemplateKey;
  audience?: 'guest' | 'staff';
  from?: string;
  to?: string;
  recipient?: string;
  relatedType?: string;
  relatedId?: string;
  page: number;
  perPage: number;
}

export const notificationKeys = {
  all: ['notifications'] as const,
  templates: ['notifications', 'templates'] as const,
  template: (key: string) => ['notifications', 'templates', key] as const,
  deliveries: (params: object) => ['notifications', 'deliveries', params] as const,
  delivery: (id: string) => ['notifications', 'delivery', id] as const,
  channels: ['notifications', 'channels'] as const,
};

export const notificationsApi = {
  templates: () => call(api.GET('/api/v1/admin/notifications/templates')),
  template: (key: TemplateKey) => call(api.GET('/api/v1/admin/notifications/templates/{key}', { params: { path: { key } } })),
  saveText: (key: TemplateKey, channel: NotificationChannel, locale: TemplateLocale, input: { subject: string | null; body: string }) =>
    call(api.PUT('/api/v1/admin/notifications/templates/{key}/{channel}/{locale}', { params: { path: { key, channel, locale } }, body: input })),
  resetText: (key: TemplateKey, channel: NotificationChannel, locale: TemplateLocale) =>
    call(api.POST('/api/v1/admin/notifications/templates/{key}/{channel}/{locale}/reset', { params: { path: { key, channel, locale } } })),
  preview: (
    key: TemplateKey,
    input: { channel: NotificationChannel; locale: TemplateLocale; subject?: string | null; body?: string | null; params?: Record<string, string> },
  ) => call(api.POST('/api/v1/admin/notifications/templates/{key}/preview', { params: { path: { key } }, body: input })),

  deliveries: (query: DeliveryLogQuery) => call(api.GET('/api/v1/admin/notifications/deliveries', { params: { query } })),
  delivery: (id: string) => call(api.GET('/api/v1/admin/notifications/deliveries/{id}', { params: { path: { id } } })),
  resend: (id: string) => call(api.POST('/api/v1/admin/notifications/deliveries/{id}/resend', { params: { path: { id } } })),
  testSend: (input: { channel: NotificationChannel; to: string; template?: TemplateKey; locale: TemplateLocale }) =>
    call(api.POST('/api/v1/admin/notifications/test-send', { body: input })),
  channels: () => call(api.GET('/api/v1/admin/notifications/channels')),
};
