/**
 * Брони в админке (модуль Reservation): список и очереди, календарь / карта зала, карточка,
 * бронь по телефону, подтверждение, отмена (решение по депозиту), отметки, перенос.
 * Возвращают данные или бросают ApiError. Приведение типов — см. ./types.ts.
 *
 * Ключи запросов начинаются с 'reservations' — их инвалидирует лента событий (useAdminFeed).
 */
import { call, type Page, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type {
  AdminAvailability,
  AdminAvailabilityQuery,
  CancelReservationInput,
  ConfirmReservationInput,
  CreateStaffReservationInput,
  ReservationDetail,
  ReservationStatus,
  ReservationSummary,
  ReservationsListQuery,
  RescheduleReservationInput,
  Timeline,
} from './types';

function body<T>(value: unknown): T {
  return value as T;
}

export type QueueKind = 'pending' | 'awaiting_deposit' | 'needs_mark';

export const reservationKeys = {
  all: ['reservations'] as const,
  timeline: (branchId: string, date: string) => ['reservations', 'timeline', branchId, date] as const,
  list: (params: ReservationsListQuery) => ['reservations', 'list', params] as const,
  queue: (branchId: string | null, kind: QueueKind) => ['reservations', 'queue', branchId ?? 'all', kind] as const,
  detail: (id: string) => ['reservations', 'detail', id] as const,
  /** Свободные места для оператора (бронь по телефону, перенос). */
  availability: (params: AdminAvailabilityQuery) => ['reservations', 'availability', params] as const,
};

/** Параметры очереди: ждут подтверждения, ждут депозит, требуют отметки «пришли / не пришли». */
export function queueQuery(branchId: string | null, kind: QueueKind, perPage = 50): ReservationsListQuery {
  const base: ReservationsListQuery = { branchId: branchId ?? undefined, kind: 'regular', page: 1, perPage };
  if (kind === 'needs_mark') return { ...base, needsMark: true };
  return { ...base, status: [kind satisfies ReservationStatus] };
}

export const reservationsApi = {
  list: async (params: ReservationsListQuery) =>
    (await call(
      api.GET('/api/v1/admin/reservations', {
        params: {
          query: {
            branchId: params.branchId,
            dateFrom: params.dateFrom,
            dateTo: params.dateTo,
            status: params.status && params.status.length > 0 ? params.status.join(',') : undefined,
            kind: params.kind,
            source: params.source,
            venueId: params.venueId,
            hallId: params.hallId,
            q: params.q?.trim() || undefined,
            needsMark: params.needsMark || undefined,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    )) as unknown as Page<ReservationSummary>,
  timeline: async (branchId: string, date: string) =>
    (await call(api.GET('/api/v1/admin/reservations/timeline', { params: { query: { branchId, date } } }))) as unknown as Timeline,
  /**
   * Свободные места на время для оператора: включая места «только по телефону», без ограничений витрины
   * по упреждению и горизонту; часы работы, вместимость и занятость (с уборкой) проверяет сервер.
   */
  availability: async (params: AdminAvailabilityQuery) =>
    (await call(
      api.GET('/api/v1/admin/reservations/availability', {
        params: {
          query: {
            branchId: params.branchId,
            date: params.date,
            time: params.time,
            guests: params.guests,
            durationMinutes: params.durationMinutes,
            hallId: params.hallId,
            typeCode: params.typeCode,
            excludeReservationId: params.excludeReservationId,
          },
        },
      }),
    )) as unknown as AdminAvailability,
  get: async (id: string) =>
    (await call(api.GET('/api/v1/admin/reservations/{id}', { params: { path: { id } } }))) as unknown as ReservationDetail,
  /** Бронь оператором (по телефону). */
  create: async (input: CreateStaffReservationInput) =>
    (await call(
      api.POST('/api/v1/admin/reservations', { body: body<Schemas['CreateStaffReservationDto']>(input) }),
    )) as unknown as ReservationDetail,
  confirm: async (id: string, input: ConfirmReservationInput = {}) =>
    (await call(
      api.POST('/api/v1/admin/reservations/{id}/confirm', {
        params: { path: { id } },
        body: body<Schemas['ConfirmReservationDto']>(input),
      }),
    )) as unknown as ReservationDetail,
  cancel: async (id: string, input: CancelReservationInput) =>
    (await call(
      api.POST('/api/v1/admin/reservations/{id}/cancel', {
        params: { path: { id } },
        body: body<Schemas['CancelReservationDto']>(input),
      }),
    )) as unknown as ReservationDetail,
  arrived: async (id: string) =>
    (await call(api.POST('/api/v1/admin/reservations/{id}/arrived', { params: { path: { id } } }))) as unknown as ReservationDetail,
  noShow: async (id: string) =>
    (await call(api.POST('/api/v1/admin/reservations/{id}/no-show', { params: { path: { id } } }))) as unknown as ReservationDetail,
  reschedule: async (id: string, input: RescheduleReservationInput) =>
    (await call(
      api.POST('/api/v1/admin/reservations/{id}/reschedule', {
        params: { path: { id } },
        body: body<Schemas['RescheduleReservationDto']>(input),
      }),
    )) as unknown as ReservationDetail,
};
