/** Зоны доставки филиала (право delivery_zones.manage в филиале). Пересечение зон проверяет сервер. */
import { call } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type { CreateDeliveryZoneInput, DeliveryZone, DeliveryZoneInput } from './zone-form';

export const zonesKeys = {
  all: ['delivery-zones'] as const,
  branch: (branchId: string) => ['delivery-zones', branchId] as const,
};

export const zonesApi = {
  list: async (branchId: string) =>
    (await call(api.GET('/api/v1/admin/delivery-zones', { params: { query: { branchId } } }))) as unknown as DeliveryZone[],
  create: async (input: CreateDeliveryZoneInput) =>
    (await call(api.POST('/api/v1/admin/delivery-zones', { body: input }))) as unknown as DeliveryZone,
  update: async (id: string, input: DeliveryZoneInput) =>
    (await call(
      api.PUT('/api/v1/admin/delivery-zones/{id}', { params: { path: { id } }, body: input }),
    )) as unknown as DeliveryZone,
  remove: (id: string) => call(api.DELETE('/api/v1/admin/delivery-zones/{id}', { params: { path: { id } } })),
};
