/**
 * Состояние POS по филиалам: провайдер и настройка, возможности адаптера, синхронизация стоп-листа
 * (последняя, неудачи подряд, ошибка), номенклатура, число сопоставлений, передачи заказов по статусам.
 * Ручной запуск синхронизации стоп-листа и импорта номенклатуры (фоновые задачи).
 */
import { CloudDownloadOutlined, SyncOutlined, WarningOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Badge, Button, Card, Col, Descriptions, Empty, Row, Space, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { posApi, posKeys, type PosBranchStatus, type QueuedJob } from './api';
import { usePosAbilities } from './abilities';

export function PosStatusTab() {
  const { t } = useTranslation();
  const { selectedBranchId } = useBranch();
  const status = useApiQuery(posKeys.status(selectedBranchId), () => posApi.status(selectedBranchId), { refetchInterval: 30_000 });
  if (status.error) return <ErrorAlert error={status.error} onRetry={() => void status.refetch()} />;
  if (!status.data) return <PageLoader />;
  if (status.data.length === 0) return <Empty description={t('pos.status.empty')} />;
  return (
    <Row gutter={[16, 16]}>
      {status.data.map((branch) => (
        <Col key={branch.branchId} xs={24} xl={12}>
          <BranchStatusCard status={branch} />
        </Col>
      ))}
    </Row>
  );
}

function BranchStatusCard({ status: s }: { status: PosBranchStatus }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const abilities = usePosAbilities();
  const [busy, setBusy] = useState<'sync' | 'import' | null>(null);
  const canOperate = abilities.canOperate(s.branchId);
  const canConfigure = abilities.canConfigure(s.branchId);

  const run = async (kind: 'sync' | 'import') => {
    setBusy(kind);
    try {
      const job: QueuedJob = kind === 'sync' ? await posApi.syncStopList(s.branchId) : await posApi.importProducts(s.branchId);
      void message.success(job.alreadyQueued ? t('pos.status.alreadyQueued') : t(kind === 'sync' ? 'pos.status.syncQueued' : 'pos.status.importQueued'));
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(null);
    }
  };

  const healthy = s.configured && s.providerKnown && !s.routingError && s.stopList.failures === 0 && s.exports.failed === 0;

  return (
    <Card
      title={
        <Space wrap>
          <Badge status={healthy ? 'success' : 'warning'} />
          {translate(s.branchName, i18n.language) || s.branchCode}
          {!s.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
        </Space>
      }
      extra={
        <Space wrap>
          {s.capabilities.stopList ? (
            <Button size="small" icon={<SyncOutlined />} disabled={!canOperate} loading={busy === 'sync'} onClick={() => void run('sync')}>
              {t('pos.status.syncStopList')}
            </Button>
          ) : null}
          {s.capabilities.nomenclature ? (
            <Button size="small" icon={<CloudDownloadOutlined />} disabled={!canConfigure} loading={busy === 'import'} onClick={() => void run('import')}>
              {t('pos.status.importProducts')}
            </Button>
          ) : null}
        </Space>
      }
    >
      {s.routingError ? <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('pos.status.routingError')} description={s.routingError} /> : null}
      {!s.configured && s.provider !== 'manual' ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('pos.status.notConfigured')}
          action={abilities.canIntegrations ? <Link to="/integrations">{t('pos.status.openIntegrations')}</Link> : null}
        />
      ) : null}
      <Descriptions size="small" column={1}>
        <Descriptions.Item label={t('pos.status.provider')}>
          <Space size={4} wrap>
            <Tag color={s.provider === 'manual' ? 'default' : 'blue'}>{s.provider === 'manual' ? t('pos.status.manualProvider') : s.provider}</Tag>
            {!s.providerKnown ? <Tag color="error">{t('pos.status.unknownProvider')}</Tag> : null}
            {s.configured ? <Tag color="success">{t('pos.status.configured')}</Tag> : null}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label={t('pos.status.capabilities')}>
          <Space size={4} wrap>
            {(['pushOrders', 'stopList', 'nomenclature'] as const).map((cap) => (
              <Tag key={cap} color={s.capabilities[cap] ? 'green' : 'default'}>
                {t(`pos.status.caps.${cap}`)}
              </Tag>
            ))}
          </Space>
        </Descriptions.Item>
        {s.capabilities.stopList ? (
          <Descriptions.Item label={t('pos.status.stopList')}>
            <Space direction="vertical" size={0}>
              <span>
                {t('pos.status.syncedAt', { date: formatDateTime(s.stopList.syncedAt) })}
                {s.stopList.lastChanges > 0 ? ` · ${t('pos.status.lastChanges', { count: s.stopList.lastChanges })}` : ''}
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('pos.status.attemptedAt', { date: formatDateTime(s.stopList.attemptedAt) })}
              </Typography.Text>
              {s.stopList.failures > 0 ? (
                <Typography.Text type="danger">
                  <WarningOutlined /> {t('pos.status.failures', { count: s.stopList.failures })}
                  {s.stopList.error ? `: ${s.stopList.error}` : ''}
                </Typography.Text>
              ) : null}
            </Space>
          </Descriptions.Item>
        ) : null}
        {s.capabilities.nomenclature ? (
          <Descriptions.Item label={t('pos.status.products')}>
            <Space direction="vertical" size={0}>
              <span>
                {t('pos.status.productsCount', { count: s.products.count })} · {t('pos.status.importedAt', { date: formatDateTime(s.products.importedAt) })}
              </span>
              {s.products.requestedAt && (!s.products.importedAt || s.products.requestedAt > s.products.importedAt) ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {t('pos.status.importRequested', { date: formatDateTime(s.products.requestedAt) })}
                </Typography.Text>
              ) : null}
              {s.products.error ? <Typography.Text type="danger">{s.products.error}</Typography.Text> : null}
            </Space>
          </Descriptions.Item>
        ) : null}
        <Descriptions.Item label={t('pos.status.mappings')}>
          {abilities.canIntegrations ? <Link to="/pos/mappings">{s.mappingsCount}</Link> : s.mappingsCount}
        </Descriptions.Item>
        <Descriptions.Item label={t('pos.status.exports')}>
          <Space size={4} wrap>
            {(['pending', 'sent', 'failed', 'skipped'] as const).map((key) => (
              <Tooltip key={key} title={t(`pos.exports.statuses.${key}`)}>
                <Link to={`/pos/exports?status=${key}`}>
                  <Tag color={key === 'failed' && s.exports.failed > 0 ? 'error' : key === 'pending' ? 'processing' : 'default'}>
                    {t(`pos.exports.statuses.${key}`)}: {s.exports[key]}
                  </Tag>
                </Link>
              </Tooltip>
            ))}
          </Space>
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
