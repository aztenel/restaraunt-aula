/**
 * Выгрузка продаж и документов в учёт (1С, этап 3): XML, близкий к EnterpriseData, или XLSX за период
 * по филиалу или по всей сети (reports.export). Файл строится задачей в очереди; при настроенном
 * HTTP-сервисе 1С XML отправляется туда (повтор отправки — вручную).
 */
import { CloudUploadOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Form, Radio, Row, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useAuth } from '@/shared/auth/AuthProvider';
import { branchesWith } from '@/shared/auth/permissions';
import { useBranch } from '@/shared/branch/BranchProvider';
import { dayjs, formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { reportKeys, reportsApi } from '../api';
import { periodIssue } from '../period';
import { useMoney, useReportContext } from '../report-ui';
import { canAccountingExport } from '../scope';
import type { AccountingExport, AccountingExportFormat } from '../types';

const STATUS_COLORS: Record<AccountingExport['status'], string> = { pending: 'processing', ready: 'success', failed: 'error' };
const PUSH_COLORS: Record<AccountingExport['pushStatus'], string> = { not_required: 'default', pending: 'processing', pushed: 'success', failed: 'error' };

interface ExportFormValues {
  range: [Dayjs, Dayjs] | null;
  format: AccountingExportFormat;
  branchId: string | null;
  push: boolean;
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AccountingTab() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const money = useMoney();
  const { me } = useAuth();
  const { params } = useReportContext();
  const { branchName } = useBranch();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<ExportFormValues>();
  const [creating, setCreating] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);
  const [page, setPage] = useState({ page: 1, perPage: 20 });
  const exportScope = branchesWith(me, Permission.ReportsExport);
  const canAll = exportScope === 'all';
  const format = Form.useWatch('format', form) as AccountingExportFormat | undefined;

  const list = useApiQuery(reportKeys.accounting(page), () => reportsApi.accountingExports(page.page, page.perPage), {
    keepPrevious: true,
    // Пока есть файлы в работе или отправки в 1С — обновлять список.
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === 'pending' || e.pushStatus === 'pending') ? 5_000 : false),
  });

  const create = async () => {
    let values: ExportFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (!values.range) return;
    const period = { from: values.range[0].format('YYYY-MM-DD'), to: values.range[1].format('YYYY-MM-DD') };
    const issue = periodIssue(period);
    if (issue) {
      form.setFields([{ name: 'range', errors: [t(`reports.period.issues.${issue}`)] }]);
      return;
    }
    if (!canAccountingExport(me, values.branchId)) {
      form.setFields([{ name: 'branchId', errors: [t('reports.accounting.noPermission')] }]);
      return;
    }
    setCreating(true);
    try {
      await reportsApi.createAccountingExport({
        ...period,
        format: values.format,
        ...(values.branchId ? { branchId: values.branchId } : {}),
        push: values.format === 'onec_xml' ? values.push : false,
      });
      void message.success(t('reports.accounting.created'));
      setPage((p) => ({ ...p, page: 1 }));
      void queryClient.invalidateQueries({ queryKey: ['reports', 'accounting'] });
    } catch (error) {
      notifyError(error);
    } finally {
      setCreating(false);
    }
  };

  const push = async (id: string) => {
    setPushing(id);
    try {
      await reportsApi.pushAccountingExport(id);
      void message.success(t('reports.accounting.pushQueued'));
      void queryClient.invalidateQueries({ queryKey: ['reports', 'accounting'] });
    } catch (error) {
      notifyError(error);
    } finally {
      setPushing(null);
    }
  };

  return (
    <>
      <Card title={t('reports.accounting.createTitle')}>
        <Typography.Paragraph type="secondary">{t('reports.accounting.hint')}</Typography.Paragraph>
        <Form<ExportFormValues>
          form={form}
          layout="vertical"
          initialValues={{
            range: [dayjs(params.from), dayjs(params.to)],
            format: 'onec_xml',
            branchId: params.branchId ?? (canAll ? null : (exportScope as string[])[0] ?? null),
            push: true,
          }}
        >
          <Row gutter={16} align="bottom">
            <Col xs={24} md={8}>
              <Form.Item name="range" label={t('reports.period.label')} rules={[{ required: true, message: t('common.required') }]}>
                <DatePicker.RangePicker format="DD.MM.YYYY" style={{ width: '100%' }} allowClear={false} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="branchId" label={t('reports.fields.branch')}>
                <BranchSelect allowAll={canAll} onlyIds={canAll ? undefined : (exportScope as string[])} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item name="format" label={t('reports.accounting.format')}>
                <Radio.Group optionType="button">
                  <Radio value="onec_xml">{t('reports.accounting.formats.onec_xml')}</Radio>
                  <Radio value="xlsx">{t('reports.accounting.formats.xlsx')}</Radio>
                </Radio.Group>
              </Form.Item>
            </Col>
            <Col xs={24} md={4}>
              <Form.Item>
                <Button type="primary" block loading={creating} onClick={() => void create()}>
                  {t('reports.accounting.create')}
                </Button>
              </Form.Item>
            </Col>
          </Row>
          {format === 'onec_xml' ? (
            <Form.Item name="push" valuePropName="checked" style={{ marginTop: -8 }}>
              <Checkbox>{t('reports.accounting.push')}</Checkbox>
            </Form.Item>
          ) : null}
        </Form>
      </Card>
      <Card
        title={t('reports.accounting.listTitle')}
        style={{ marginTop: 16 }}
        extra={<Button icon={<ReloadOutlined />} onClick={() => void list.refetch()} aria-label={t('common.refresh')} />}
      >
        {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
        <Table<AccountingExport>
          rowKey="id"
          size="small"
          loading={list.isLoading}
          dataSource={list.data?.items ?? []}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t('reports.accounting.empty') }}
          pagination={{
            current: page.page,
            pageSize: page.perPage,
            total: list.data?.total ?? 0,
            onChange: (p, perPage) => setPage({ page: perPage === page.perPage ? p : 1, perPage }),
          }}
          expandable={{
            rowExpandable: (r) => r.totals !== null,
            expandedRowRender: (r) =>
              r.totals ? (
                <Space wrap size="large">
                  <span>
                    {t('reports.accounting.totals.retailSales')}: <strong>{money(r.totals.retailSales)}</strong> ({r.totals.retailDocuments})
                  </span>
                  <span>
                    {t('reports.accounting.totals.refunds')}: <strong>{money(r.totals.refunds)}</strong>
                  </span>
                  <span>
                    {t('reports.accounting.totals.certificateSales')}: <strong>{money(r.totals.certificateSales)}</strong>
                  </span>
                  <span>
                    {t('reports.accounting.totals.invoices')}: <strong>{money(r.totals.invoices)}</strong> ({r.totals.invoiceCount})
                  </span>
                  <span>
                    {t('reports.accounting.totals.acts')}: <strong>{money(r.totals.acts)}</strong> ({r.totals.actCount})
                  </span>
                </Space>
              ) : null,
          }}
          columns={[
            { title: t('reports.accounting.requestedAt'), key: 'requestedAt', render: (_, r) => formatDateTime(r.requestedAt) },
            { title: t('reports.period.label'), key: 'period', render: (_, r) => `${r.from} — ${r.to}` },
            { title: t('reports.fields.branch'), key: 'branch', render: (_, r) => (r.branchId ? branchName(r.branchId) : t('reports.scope.consolidatedShort')) },
            { title: t('reports.accounting.format'), key: 'format', render: (_, r) => t(`reports.accounting.formats.${r.format}`) },
            {
              title: t('reports.accounting.status'),
              key: 'status',
              render: (_, r) => (
                <Tooltip title={r.error}>
                  <Tag color={STATUS_COLORS[r.status]}>{t(`reports.accounting.statuses.${r.status}`)}</Tag>
                </Tooltip>
              ),
            },
            {
              title: t('reports.accounting.pushStatus'),
              key: 'push',
              render: (_, r) => (
                <Tooltip title={r.pushError ?? (r.pushedAt ? formatDateTime(r.pushedAt) : undefined)}>
                  <Tag color={PUSH_COLORS[r.pushStatus]}>
                    {t(`reports.accounting.pushStatuses.${r.pushStatus}`)}
                    {r.pushAttempts > 1 ? ` ×${r.pushAttempts}` : ''}
                  </Tag>
                </Tooltip>
              ),
            },
            { title: t('reports.accounting.size'), key: 'size', align: 'right', render: (_, r) => formatSize(r.sizeBytes) },
            {
              key: 'actions',
              render: (_, r) => (
                <Space>
                  {r.status === 'ready' && r.fileUrl ? (
                    <Button size="small" icon={<DownloadOutlined />} href={r.fileUrl} target="_blank" rel="noreferrer">
                      {t('reports.accounting.download')}
                    </Button>
                  ) : null}
                  {r.status === 'ready' && r.format === 'onec_xml' && (r.pushStatus === 'failed' || r.pushStatus === 'not_required') ? (
                    <Button size="small" icon={<CloudUploadOutlined />} loading={pushing === r.id} onClick={() => void push(r.id)}>
                      {t('reports.accounting.repush')}
                    </Button>
                  ) : null}
                </Space>
              ),
            },
          ]}
        />
        {list.data?.items.some((e) => e.status === 'ready' && e.fileUrl) ? (
          <Alert type="info" showIcon style={{ marginTop: 12 }} message={t('reports.accounting.linkExpires')} />
        ) : null}
      </Card>
    </>
  );
}
