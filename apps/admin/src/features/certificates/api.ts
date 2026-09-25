/**
 * Эндпоинты подарочных сертификатов в админке (/api/v1/admin/certificates*): продукты, поиск и карточка,
 * проверка и погашение кода на точке, выпуск по счёту (корпоративная продажа), блокировка, продление,
 * переотправка, ссылка на PDF, отчёт. Права проверяет сервер (certificates.view / manage / redeem).
 */
import { call } from '@aula/api-client';
import { api } from '@/shared/api/client';
import { readFile } from '@/shared/lib/download';
import type { CertificateListQuery, CertificateProductInput, ManualIssueBody, RedeemBody, ResendBody } from './types';

export const certificateKeys = {
  all: ['certificates'] as const,
  list: (params: CertificateListQuery) => ['certificates', 'list', params] as const,
  detail: (id: string) => ['certificates', 'detail', id] as const,
  products: ['certificates', 'products'] as const,
  report: (from: string, to: string) => ['certificates', 'report', from, to] as const,
};

export const certificatesApi = {
  products: () => call(api.GET('/api/v1/admin/certificates/products')),
  createProduct: (input: CertificateProductInput) => call(api.POST('/api/v1/admin/certificates/products', { body: input })),
  updateProduct: (id: string, input: CertificateProductInput) =>
    call(api.PUT('/api/v1/admin/certificates/products/{id}', { params: { path: { id } }, body: input })),
  deleteProduct: (id: string) => call(api.DELETE('/api/v1/admin/certificates/products/{id}', { params: { path: { id } } })),

  list: (params: CertificateListQuery) =>
    call(
      api.GET('/api/v1/admin/certificates', {
        params: {
          query: {
            q: params.q?.trim() || undefined,
            phone: params.phone?.trim() || undefined,
            status: params.status,
            orderId: params.orderId || undefined,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    ),
  get: (id: string) => call(api.GET('/api/v1/admin/certificates/{id}', { params: { path: { id } } })),

  check: (code: string) => call(api.POST('/api/v1/admin/certificates/check', { body: { code } })),
  redeem: (body: RedeemBody) => call(api.POST('/api/v1/admin/certificates/redeem', { body })),
  issue: (body: ManualIssueBody) => call(api.POST('/api/v1/admin/certificates/issue', { body })),

  pdfLink: (id: string) => call(api.GET('/api/v1/admin/certificates/{id}/pdf-link', { params: { path: { id } } })),
  block: (id: string, reason: string) => call(api.POST('/api/v1/admin/certificates/{id}/block', { params: { path: { id } }, body: { reason } })),
  unblock: (id: string, reason: string | null) =>
    call(api.POST('/api/v1/admin/certificates/{id}/unblock', { params: { path: { id } }, body: reason ? { reason } : {} })),
  extend: (id: string, validUntil: string, reason: string) =>
    call(api.POST('/api/v1/admin/certificates/{id}/extend', { params: { path: { id } }, body: { validUntil, reason } })),
  resend: (id: string, body: ResendBody) => call(api.POST('/api/v1/admin/certificates/{id}/resend', { params: { path: { id } }, body })),

  report: (from: string, to: string) => call(api.GET('/api/v1/admin/certificates/report', { params: { query: { from, to } } })),
  reportExport: (from: string, to: string) =>
    readFile(api.GET('/api/v1/admin/certificates/report/export', { params: { query: { from, to } }, parseAs: 'blob' })),
};
