/**
 * Отчёты (модуль Reporting): JSON для экранов и выгрузки XLSX (/export), дневные отчёты,
 * помесячные итоги агрегаторов, выгрузки в учёт (1С). Возвращают данные или бросают ApiError.
 * Ключи — под 'reports' (лента событий их не перезапрашивает; отчёты обновляются по запросу и раз в минуту).
 */
import { call, type Schemas } from '@aula/api-client';
import { api } from '@/shared/api/client';
import { readFile, saveBlob } from '@/shared/lib/download';
import type { AccountingExportFormat, AggregatorVolumeInput, ReportParams } from './types';

/** Параметры запроса: без филиала — сводный отчёт. */
export function reportQuery(params: ReportParams): { from: string; to: string; branchId?: string } {
  return { from: params.from, to: params.to, ...(params.branchId ? { branchId: params.branchId } : {}) };
}

export const reportKeys = {
  all: ['reports'] as const,
  report: (report: string, params: object) => ['reports', report, params] as const,
  daily: (date: string, branchId: string | null) => ['reports', 'daily', date, branchId ?? 'all'] as const,
  dailyHistory: (params: object) => ['reports', 'daily-history', params] as const,
  aggregators: (params: object) => ['reports', 'aggregators', params] as const,
  accounting: (params: object) => ['reports', 'accounting', params] as const,
};

/** Отчёты, у которых есть выгрузка XLSX: ключ → путь. */
export const EXPORT_PATHS = {
  dashboard: '/api/v1/admin/reports/dashboard/export',
  revenue: '/api/v1/admin/reports/revenue/export',
  averageCheck: '/api/v1/admin/reports/average-check/export',
  conversion: '/api/v1/admin/reports/conversion/export',
  topDishes: '/api/v1/admin/reports/top-dishes/export',
  hallLoad: '/api/v1/admin/reports/hall-load/export',
  banquetFunnel: '/api/v1/admin/reports/banquet-funnel/export',
  cancelledOrders: '/api/v1/admin/reports/cancelled-orders/export',
  payments: '/api/v1/admin/reports/payments/export',
  certificates: '/api/v1/admin/reports/certificates/export',
  ownChannel: '/api/v1/admin/reports/own-channel/export',
  goals: '/api/v1/admin/reports/goals/export',
  daily: '/api/v1/admin/reports/daily/export',
} as const;
export type ExportKey = keyof typeof EXPORT_PATHS;

type BlobGet = (
  path: string,
  init: { params: { query: Record<string, string | number | undefined> }; parseAs: 'blob' },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

/** Скачать XLSX отчёта (имя файла — из Content-Disposition). */
export async function downloadReport(key: ExportKey, query: Record<string, string | number | undefined>): Promise<void> {
  const get = api.GET.bind(api) as unknown as BlobGet;
  const file = await readFile(get(EXPORT_PATHS[key], { params: { query }, parseAs: 'blob' }));
  saveBlob(file.blob, file.filename ?? `aula_${key}.xlsx`);
}

export const reportsApi = {
  dashboard: (branchId: string | null) =>
    call(api.GET('/api/v1/admin/reports/dashboard', { params: { query: branchId ? { branchId } : {} } })),
  revenue: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/revenue', { params: { query: reportQuery(p) } })),
  averageCheck: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/average-check', { params: { query: reportQuery(p) } })),
  conversion: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/conversion', { params: { query: reportQuery(p) } })),
  topDishes: (p: ReportParams, sort: 'revenue' | 'quantity', limit: number) =>
    call(api.GET('/api/v1/admin/reports/top-dishes', { params: { query: { ...reportQuery(p), sort, limit } } })),
  hallLoad: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/hall-load', { params: { query: reportQuery(p) } })),
  banquetFunnel: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/banquet-funnel', { params: { query: reportQuery(p) } })),
  cancelledOrders: (p: ReportParams, page: number, perPage: number) =>
    call(api.GET('/api/v1/admin/reports/cancelled-orders', { params: { query: { ...reportQuery(p), page, perPage } } })),
  payments: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/payments', { params: { query: reportQuery(p) } })),
  certificates: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/certificates', { params: { query: reportQuery(p) } })),
  ownChannel: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/own-channel', { params: { query: reportQuery(p) } })),
  goals: (p: ReportParams) => call(api.GET('/api/v1/admin/reports/goals', { params: { query: reportQuery(p) } })),

  daily: (date: string, branchId: string | null) =>
    call(api.GET('/api/v1/admin/reports/daily', { params: { query: { date, ...(branchId ? { branchId } : {}) } } })),
  dailyHistory: (p: ReportParams, page: number, perPage: number) =>
    call(api.GET('/api/v1/admin/reports/daily/history', { params: { query: { ...reportQuery(p), page, perPage } } })),

  aggregatorVolumes: (params: { fromMonth: string; toMonth: string; branchId: string | null }) =>
    call(
      api.GET('/api/v1/admin/reports/aggregator-volumes', {
        params: { query: { fromMonth: params.fromMonth, toMonth: params.toMonth, ...(params.branchId ? { branchId: params.branchId } : {}) } },
      }),
    ),
  saveAggregatorVolume: (input: AggregatorVolumeInput) => call(api.PUT('/api/v1/admin/reports/aggregator-volumes', { body: input })),

  accountingExports: (page: number, perPage: number) =>
    call(api.GET('/api/v1/admin/reports/accounting-exports', { params: { query: { page, perPage } } })),
  accountingExport: (id: string) => call(api.GET('/api/v1/admin/reports/accounting-exports/{id}', { params: { path: { id } } })),
  createAccountingExport: (input: { from: string; to: string; format: AccountingExportFormat; branchId?: string; push?: boolean }) =>
    call(api.POST('/api/v1/admin/reports/accounting-exports', { body: input as Schemas['CreateAccountingExportDto'] })),
  pushAccountingExport: (id: string) =>
    call(api.POST('/api/v1/admin/reports/accounting-exports/{id}/push', { params: { path: { id } } })),
};
