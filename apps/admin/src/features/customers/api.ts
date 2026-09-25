/**
 * Эндпоинты базы гостей в админке: гости (/admin/customers*), сегменты (/admin/customer-segments*),
 * тексты согласий (/admin/consent-texts). Права проверяет сервер: customers.view / manage / export
 * (гости общие для сети — достаточно права хотя бы в одном филиале).
 */
import { call } from '@aula/api-client';
import { api } from '@/shared/api/client';
import { intHeader, readFile } from '@/shared/lib/download';
import type {
  ConsentKind,
  CustomerListQuery,
  ExportCustomersBody,
  PublishConsentTextBody,
  RecordConsentBody,
  SaveSegmentBody,
  UpdateCustomerBody,
} from './types';

export interface CustomerDetailQuery {
  from?: string;
  to?: string;
  page: number;
  perPage: number;
}

export const customerKeys = {
  all: ['customers'] as const,
  list: (params: CustomerListQuery) => ['customers', 'list', params] as const,
  detail: (id: string, params: CustomerDetailQuery) => ['customers', 'detail', id, params] as const,
  detailRoot: (id: string) => ['customers', 'detail', id] as const,
  tags: ['customers', 'tags'] as const,
  segments: ['customers', 'segments'] as const,
  segment: (id: string) => ['customers', 'segments', id] as const,
  consentTexts: ['customers', 'consent-texts'] as const,
};

export const customersApi = {
  list: (params: CustomerListQuery) => call(api.GET('/api/v1/admin/customers', { params: { query: params } })),
  tags: () => call(api.GET('/api/v1/admin/customers/tags')),
  get: (id: string, query: CustomerDetailQuery) => call(api.GET('/api/v1/admin/customers/{id}', { params: { path: { id }, query } })),
  update: (id: string, body: UpdateCustomerBody) => call(api.PATCH('/api/v1/admin/customers/{id}', { params: { path: { id } }, body })),
  recordConsent: (id: string, body: RecordConsentBody) =>
    call(api.POST('/api/v1/admin/customers/{id}/consents', { params: { path: { id } }, body })),
  anonymize: (id: string, reason: string | null) =>
    call(api.POST('/api/v1/admin/customers/{id}/anonymize', { params: { path: { id } }, body: reason ? { reason } : {} })),
  /** Файл выгрузки + число строк из заголовка X-Export-Count. */
  export: async (body: ExportCustomersBody) => {
    const file = await readFile(api.POST('/api/v1/admin/customers/export', { body, parseAs: 'blob' }));
    return { ...file, count: intHeader(file.headers, 'x-export-count') };
  },

  segments: () => call(api.GET('/api/v1/admin/customer-segments')),
  segment: (id: string) => call(api.GET('/api/v1/admin/customer-segments/{id}', { params: { path: { id } } })),
  createSegment: (body: SaveSegmentBody) => call(api.POST('/api/v1/admin/customer-segments', { body })),
  updateSegment: (id: string, body: SaveSegmentBody) =>
    call(api.PATCH('/api/v1/admin/customer-segments/{id}', { params: { path: { id } }, body })),
  deleteSegment: (id: string) => call(api.DELETE('/api/v1/admin/customer-segments/{id}', { params: { path: { id } } })),

  consentTexts: (kind?: ConsentKind) => call(api.GET('/api/v1/admin/consent-texts', { params: { query: kind ? { kind } : {} } })),
  publishConsentText: (body: PublishConsentTextBody) => call(api.POST('/api/v1/admin/consent-texts', { body })),
};
