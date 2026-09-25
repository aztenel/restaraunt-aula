/**
 * Эндпоинты платежей в админке (/api/v1/admin/payments*): список, карточка, возврат, отметка
 * получения денег (оплата при получении), очередь возвратов и ручное подтверждение/отклонение.
 * Права проверяет сервер: payments.view (филиал платежа), payments.refund, payments.manual.
 */
import { call } from '@aula/api-client';
import { api } from '@/shared/api/client';
import type { CreateRefundBody, PaymentListQuery, RefundQueueQuery } from './types';

export const paymentKeys = {
  all: ['payments'] as const,
  list: (params: PaymentListQuery) => ['payments', 'list', params] as const,
  detail: (id: string) => ['payments', 'detail', id] as const,
  refunds: (params: RefundQueueQuery) => ['payments', 'refunds', params] as const,
};

export const paymentsApi = {
  list: (params: PaymentListQuery) =>
    call(
      api.GET('/api/v1/admin/payments', {
        params: {
          query: {
            branchId: params.branchId,
            purpose: params.purpose,
            method: params.method,
            provider: params.provider?.trim() || undefined,
            status: params.status,
            referenceId: params.referenceId?.trim() || undefined,
            from: params.from,
            to: params.to,
            page: params.page,
            perPage: params.perPage,
          },
        },
      }),
    ),
  get: (id: string) => call(api.GET('/api/v1/admin/payments/{id}', { params: { path: { id } } })),
  refund: (id: string, body: CreateRefundBody) => call(api.POST('/api/v1/admin/payments/{id}/refunds', { params: { path: { id } }, body })),
  collect: (id: string) => call(api.POST('/api/v1/admin/payments/{id}/collect', { params: { path: { id } } })),
  refunds: (params: RefundQueueQuery) =>
    call(
      api.GET('/api/v1/admin/payments/refunds', {
        params: { query: { branchId: params.branchId, status: params.status, mode: params.mode, page: params.page, perPage: params.perPage } },
      }),
    ),
  confirmRefund: (refundId: string, comment: string | null) =>
    call(
      api.POST('/api/v1/admin/payments/refunds/{refundId}/confirm', {
        params: { path: { refundId } },
        body: comment ? { comment } : {},
      }),
    ),
  rejectRefund: (refundId: string, reason: string) =>
    call(api.POST('/api/v1/admin/payments/refunds/{refundId}/reject', { params: { path: { refundId } }, body: { reason } })),
};
