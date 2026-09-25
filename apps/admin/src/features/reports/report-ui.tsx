/**
 * Общие элементы отчётов: контекст периода и филиала, запрос отчёта, карточка отчёта с выгрузкой XLSX,
 * показатели (stat tiles), цвета каналов и подсказки графиков (суммы — formatMoney при выводе).
 */
import { DownloadOutlined } from '@ant-design/icons';
import { Button, Card, Col, Row, Statistic, Tooltip, Typography } from 'antd';
import type { QueryKey } from '@tanstack/react-query';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiError, Money } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { downloadReport, reportKeys, reportQuery, type ExportKey } from './api';
import { moneyText } from './chart-data';
import type { ReportParams, SalesChannel } from './types';

export interface ReportContextValue {
  params: ReportParams;
  /** Подпись области: филиал или «сводный по сети». */
  scopeLabel: string;
}

export const ReportContext = createContext<ReportContextValue | null>(null);

export function useReportContext(): ReportContextValue {
  const value = useContext(ReportContext);
  if (!value) throw new Error('useReportContext must be used inside <ReportsPage>');
  return value;
}

/** Запрос отчёта по текущему периоду и филиалу (ключ — ['reports', name, params]). */
export function useReport<T>(name: string, fn: (params: ReportParams) => Promise<T>, extra: object = {}) {
  const { params } = useReportContext();
  const key: QueryKey = reportKeys.report(name, { ...params, ...extra });
  return useApiQuery<T>(key, () => fn(params), { keepPrevious: true, staleTime: 60_000 });
}

/** Цвета каналов продаж — категориальная палитра (проверена на различимость при дальтонизме). */
export const CHANNEL_COLORS: Record<SalesChannel, string> = {
  delivery: '#2a78d6',
  pickup: '#eb6834',
  banquet: '#1baf7a',
  certificate: '#eda100',
};

/** Вторичная серия (сравнение двух величин одной единицы). */
export const SERIES_COLORS = ['#2a78d6', '#eb6834'] as const;

/** Оформление осей и сетки: сдержанные цвета, чтобы данные читались первыми. */
export const AXIS_PROPS = { stroke: '#c3c2b7', tick: { fill: '#6b6a66', fontSize: 12 }, tickLine: false } as const;
export const GRID_PROPS = { stroke: '#ece9e2', strokeDasharray: '3 3', vertical: false } as const;

export function ExportButton({ report, query, disabled }: { report: ExportKey; query?: Record<string, string | number | undefined>; disabled?: boolean }) {
  const { t } = useTranslation();
  const { params } = useReportContext();
  const notifyError = useNotifyError();
  const [loading, setLoading] = useState(false);
  return (
    <Button
      icon={<DownloadOutlined />}
      loading={loading}
      disabled={disabled}
      onClick={async () => {
        setLoading(true);
        try {
          await downloadReport(report, query ?? reportQuery(params));
        } catch (error) {
          notifyError(error, t('reports.exportFailed'));
        } finally {
          setLoading(false);
        }
      }}
    >
      {t('reports.exportXlsx')}
    </Button>
  );
}

/** Карточка отчёта: заголовок, выгрузка XLSX, загрузка / ошибка. */
export function ReportCard({
  title,
  exportKey,
  exportQuery,
  query,
  extra,
  children,
}: {
  title: ReactNode;
  exportKey?: ExportKey;
  exportQuery?: Record<string, string | number | undefined>;
  query: { isLoading: boolean; error: ApiError | null; refetch: () => unknown; data: unknown };
  extra?: ReactNode;
  children: ReactNode;
}) {
  const { scopeLabel } = useReportContext();
  return (
    <Card
      title={
        <div>
          <div>{title}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            {scopeLabel}
          </Typography.Text>
        </div>
      }
      extra={
        <Row gutter={8} wrap={false}>
          {extra ? <Col>{extra}</Col> : null}
          {exportKey ? (
            <Col>
              <ExportButton report={exportKey} query={exportQuery} disabled={!query.data} />
            </Col>
          ) : null}
        </Row>
      }
    >
      {query.error ? <ErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!query.data && query.isLoading ? <PageLoader /> : null}
      {query.data ? children : null}
    </Card>
  );
}

export interface Stat {
  key: string;
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}

/** Ряд показателей (KPI). */
export function StatRow({ stats, span = 6 }: { stats: Stat[]; span?: number }) {
  return (
    <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
      {stats.map((stat) => (
        <Col key={stat.key} xs={12} md={span}>
          <Card size="small" styles={{ body: { padding: 12 } }}>
            <Statistic
              title={
                stat.hint ? (
                  <Tooltip title={stat.hint}>
                    <span style={{ borderBottom: '1px dotted #bfbfbf' }}>{stat.label}</span>
                  </Tooltip>
                ) : (
                  stat.label
                )
              }
              valueRender={() => <span style={{ fontSize: 22, fontWeight: 600 }}>{stat.value}</span>}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/** Сумма от сервера (тиыны) в показателе / таблице. */
export function useMoney() {
  const { i18n } = useTranslation();
  return (money: Money | null | undefined) => (money ? moneyText(money.amount, i18n.language) : '—');
}

/** Подсказка графика со суммами по сериям (тиыны → ₸) и дополнительными строками. */
export function MoneyTooltip({
  active,
  payload,
  label,
  names,
  extraRows,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown; color?: string; payload?: Record<string, unknown> }>;
  label?: ReactNode;
  names: Record<string, string>;
  extraRows?: (row: Record<string, unknown>) => Array<{ label: string; value: string }>;
}) {
  const { i18n } = useTranslation();
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload ?? {};
  return (
    <div style={{ background: '#fff', border: '1px solid #e1e0d9', borderRadius: 8, padding: '8px 12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {payload.map((item) => (
        <div key={String(item.dataKey)} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: item.color, display: 'inline-block' }} />
          <span style={{ color: '#52514e' }}>{names[String(item.dataKey)] ?? String(item.dataKey)}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{moneyText(Number(item.value ?? 0), i18n.language)}</span>
        </div>
      ))}
      {(extraRows?.(row) ?? []).map((extra) => (
        <div key={extra.label} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#52514e' }}>
          <span>{extra.label}</span>
          <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{extra.value}</span>
        </div>
      ))}
    </div>
  );
}
