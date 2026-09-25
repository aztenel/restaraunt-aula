/**
 * Конфигурация залов (модуль Reservation): типы мест (справочник сети), залы и места филиала,
 * фон плана и фото мест, настройки бронирования филиала. Возвращают данные или бросают ApiError.
 * Приведение типов — см. ./types.ts.
 *
 * Ключи — под 'venues' (лента событий их не перезапрашивает). После изменения мест и залов нужно
 * обновить и календарь броней (['reservations']) — там те же места.
 */
import { call, type Schemas } from '@aula/api-client';
import { imageFormData } from '@/shared/api/catalog';
import { api } from '@/shared/api/client';
import type {
  Hall,
  HallInput,
  HallPatch,
  ReservationSettings,
  ReservationSettingsInput,
  Venue,
  VenueInput,
  VenuePatch,
  VenueType,
  VenueTypeInput,
} from './types';

function body<T>(value: unknown): T {
  return value as T;
}

export const venueKeys = {
  all: ['venues'] as const,
  types: ['venues', 'types'] as const,
  halls: (branchId: string) => ['venues', 'halls', branchId] as const,
  venues: (branchId: string) => ['venues', 'list', branchId] as const,
  settings: (branchId: string) => ['venues', 'settings', branchId] as const,
};

export const venueConfigApi = {
  // ---------------------------------------------------------- типы мест (глобально)
  types: async () => (await call(api.GET('/api/v1/admin/venue-types'))) as unknown as VenueType[],
  createType: async (input: VenueTypeInput) =>
    (await call(api.POST('/api/v1/admin/venue-types', { body: body<Schemas['CreateVenueTypeDto']>(input) }))) as unknown as VenueType,
  updateType: async (id: string, input: Partial<VenueTypeInput>) =>
    (await call(
      api.PATCH('/api/v1/admin/venue-types/{id}', { params: { path: { id } }, body: body<Schemas['UpdateVenueTypeDto']>(input) }),
    )) as unknown as VenueType,
  deleteType: (id: string) => call(api.DELETE('/api/v1/admin/venue-types/{id}', { params: { path: { id } } })),

  // ---------------------------------------------------------- залы филиала
  halls: async (branchId: string) =>
    (await call(api.GET('/api/v1/admin/halls', { params: { query: { branchId } } }))) as unknown as Hall[],
  createHall: async (input: HallInput) =>
    (await call(api.POST('/api/v1/admin/halls', { body: body<Schemas['CreateHallDto']>(input) }))) as unknown as Hall,
  updateHall: async (id: string, patch: HallPatch) =>
    (await call(
      api.PATCH('/api/v1/admin/halls/{id}', { params: { path: { id } }, body: body<Schemas['UpdateHallDto']>(patch) }),
    )) as unknown as Hall,
  deleteHall: (id: string) => call(api.DELETE('/api/v1/admin/halls/{id}', { params: { path: { id } } })),
  /** Фон плана зала (JPEG / PNG / WebP до 10 МБ). */
  setHallBackground: async (id: string, file: File) =>
    (await call(
      api.PUT('/api/v1/admin/halls/{id}/background', {
        params: { path: { id } },
        body: body<{ file: string }>(imageFormData(file)),
      }),
    )) as unknown as Hall,
  removeHallBackground: async (id: string) =>
    (await call(api.DELETE('/api/v1/admin/halls/{id}/background', { params: { path: { id } } }))) as unknown as Hall,

  // ---------------------------------------------------------- места
  venues: async (branchId: string) =>
    (await call(api.GET('/api/v1/admin/venues', { params: { query: { branchId } } }))) as unknown as Venue[],
  createVenue: async (input: VenueInput) =>
    (await call(api.POST('/api/v1/admin/venues', { body: body<Schemas['CreateVenueDto']>(input) }))) as unknown as Venue,
  updateVenue: async (id: string, patch: VenuePatch) =>
    (await call(
      api.PATCH('/api/v1/admin/venues/{id}', { params: { path: { id } }, body: body<Schemas['UpdateVenueDto']>(patch) }),
    )) as unknown as Venue,
  deleteVenue: (id: string) => call(api.DELETE('/api/v1/admin/venues/{id}', { params: { path: { id } } })),
  addVenuePhoto: async (id: string, file: File) =>
    (await call(
      api.POST('/api/v1/admin/venues/{id}/photos', {
        params: { path: { id } },
        body: body<{ file: string }>(imageFormData(file)),
      }),
    )) as unknown as Venue,
  deleteVenuePhoto: async (id: string, photoId: string) =>
    (await call(
      api.DELETE('/api/v1/admin/venues/{id}/photos/{photoId}', { params: { path: { id, photoId } } }),
    )) as unknown as Venue,

  // ---------------------------------------------------------- настройки филиала
  settings: async (branchId: string) =>
    (await call(
      api.GET('/api/v1/admin/reservation-settings/{branchId}', { params: { path: { branchId } } }),
    )) as unknown as ReservationSettings,
  saveSettings: async (branchId: string, input: ReservationSettingsInput) =>
    (await call(
      api.PUT('/api/v1/admin/reservation-settings/{branchId}', {
        params: { path: { branchId } },
        body: body<Schemas['UpdateReservationSettingsDto']>(input),
      }),
    )) as unknown as ReservationSettings,
};
