/**
 * Формы ответов отчётов (модуль Reporting, apps/api/src/modules/reporting/http/dto.ts) — из сгенерированной
 * схемы docs/openapi.json (типы точные). Суммы — тиыны от сервера, доли — 0..1 (null — знаменатель 0).
 */
import type { Schemas } from '@aula/api-client';

export type ChannelAmounts = Schemas['ChannelAmountsDto'];
export type RevenueReport = Schemas['RevenueReportDto'];
export type RevenueDay = Schemas['RevenueDayDto'];
export type AverageCheckReport = Schemas['AverageCheckReportDto'];
export type ConversionReport = Schemas['ConversionReportDto'];
export type TopDishesReport = Schemas['TopDishesReportDto'];
export type HallLoadReport = Schemas['HallLoadReportDto'];
export type HallLoadRow = Schemas['HallLoadRowDto'];
export type BanquetFunnelReport = Schemas['BanquetFunnelReportDto'];
export type BanquetStage = Schemas['BanquetStageDto'];
export type CancelledOrdersReport = Schemas['CancelledOrdersReportDto'];
export type CancelledOrder = Schemas['CancelledOrderDto'];
export type CashFlowReport = Schemas['CashFlowReportDto'];
export type CertificatesReport = Schemas['CertificatesReportDto'];
export type OwnChannelReport = Schemas['OwnChannelReportDto'];
export type AggregatorVolume = Schemas['AggregatorVolumeDto'];
export type AggregatorVolumeInput = Schemas['AggregatorVolumeInputDto'];
export type GoalsReport = Schemas['GoalsReportDto'];
export type DashboardReport = Schemas['DashboardDto'];
export type PeriodKpis = Schemas['PeriodKpisDto'];
export type DailyReport = Schemas['DailyReportDto'];
export type DailyReportsPage = Schemas['DailyReportsPageDto'];
export type AccountingExport = Schemas['AccountingExportDto'];
export type AccountingExportsPage = Schemas['AccountingExportsPageDto'];
export type AccountingExportFormat = AccountingExport['format'];

export const SALES_CHANNELS = ['delivery', 'pickup', 'banquet', 'certificate'] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const BANQUET_STAGES = ['new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held'] as const;

/** Коды причин отмены заказа (ordering: CANCEL_REASON_CODES). */
export const CANCEL_REASON_CODES = ['guest_request', 'not_paid_in_time', 'out_of_stock', 'cannot_deliver', 'duplicate', 'other'] as const;

/** Параметры отчёта: период (локальные даты Asia/Almaty, включительно) и филиал (null — сводный). */
export interface ReportParams {
  from: string;
  to: string;
  branchId: string | null;
}
