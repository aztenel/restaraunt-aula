import { z } from 'zod';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';

/** Яндекс.Доставка (B2B API «Экспресс-доставка», заявки cargo claims v2). Имя провайдера — только в адаптере. */
export const YANDEX_DELIVERY_PROVIDER = 'yandex';
export const YANDEX_DELIVERY_SETTINGS_KEY = 'ordering.yandex_delivery';
export const YANDEX_DELIVERY_DEFAULT_BASE_URL = 'https://b2b.taxi.yandex.net';

export const YandexDeliverySettingsSchema = z.object({
  /** OAuth-токен корпоративного клиента (кабинет Яндекс.Доставки → Интеграция). */
  token: z.string().trim().min(1),
  baseUrl: z
    .string()
    .url()
    .default(YANDEX_DELIVERY_DEFAULT_BASE_URL)
    .transform((u) => u.replace(/\/+$/, '')),
  /** Тариф: express (легковой/пеший курьер), courier, cargo. */
  taxiClass: z.enum(['express', 'courier', 'cargo']).default('express'),
  /** Контакт на случай проблем с доставкой; по умолчанию — телефон филиала. */
  emergencyContactName: z.string().trim().min(1).default('AULA'),
  emergencyContactPhone: z.string().trim().min(1).nullish(),
  timeoutMs: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
});
export type YandexDeliverySettings = z.infer<typeof YandexDeliverySettingsSchema>;

export const YANDEX_DELIVERY_INTEGRATION: IntegrationDescriptor = {
  key: YANDEX_DELIVERY_SETTINGS_KEY,
  title: 'Яндекс.Доставка (B2B API)',
  category: 'delivery',
  stage: 3,
  description:
    'Курьеры Яндекс.Доставки для заказов доставки: при переходе заказа в «Готов» создаётся заявка, статус и курьер ' +
    'опрашиваются задачей, «забрал» / «доставил» двигают заказ. Филиал направляется в службу настройкой «Доставка: курьеры по филиалам».',
  fields: [
    { name: 'token', label: 'OAuth-токен', type: 'string', secret: true, required: true, help: 'Кабинет Яндекс.Доставки → Интеграция → API' },
    { name: 'baseUrl', label: 'Адрес API', type: 'url', help: `По умолчанию ${YANDEX_DELIVERY_DEFAULT_BASE_URL}` },
    { name: 'taxiClass', label: 'Тариф', type: 'select', options: ['express', 'courier', 'cargo'] },
    { name: 'emergencyContactName', label: 'Контакт для экстренной связи', type: 'string' },
    { name: 'emergencyContactPhone', label: 'Телефон для экстренной связи', type: 'string', help: 'По умолчанию — телефон филиала' },
    { name: 'timeoutMs', label: 'Таймаут запроса, мс', type: 'number', help: 'По умолчанию 15000' },
  ],
};
