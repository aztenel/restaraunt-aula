import { DownloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, Flex, Result, Row, Space, Spin, Statistic, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney, type Money } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';
import { saveBlob } from '@/shared/lib/download';
import { DateRangeFilter, type DateRangeValue } from '@/shared/ui/DateRangeFilter';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';

function thisMonth(): [Dayjs, Dayjs] {
  const today = dayjs().tz(DISPLAY_TIMEZONE);
  return [today.startOf('month'), today];
}

function MoneyStat({ title, value, extra }: { title: string; value: Money; extra?: ReactNode }) {
  const { i18n } = useTranslation();
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Statistic title={title} value={formatMoney(value, i18n.language)} />
      {extra ? <div style={{ marginTop: 4 }}>{extra}</div> : null}
    </Card>
  );
}

/**
 * Отчёт по сертификатам за период (даты Asia/Almaty, включительно): выпущено, погашено, возвращено на
 * сертификаты, просрочено, восстановлено; остаток обязательств — на текущий момент. Выгрузка XLSX.
 */
export function ReportTab() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const abilities = useCertificateAbilities();
  const [range, setRange] = useState<DateRangeValue>(thisMonth);
  const [exporting, setExporting] = useState(false);
  const from = range?.[0].format('YYYY-MM-DD') ?? '';
  const to = range?.[1].format('YYYY-MM-DD') ?? '';
  const report = useApiQuery(certificateKeys.report(from, to), () => certificatesApi.report(from, to), {
    enabled: abilities.report && Boolean(range),
    keepPrevious: true,
  });
  const money = (value: Money) => formatMoney(value, i18n.language);
  const secondary = (text: string) => (
    <Typography.Text type="secondary" style={{ display: 'block' }}>
      {text}
    </Typography.Text>
  );

  if (!abilities.report) return <Result status="403" subTitle={t('certificates.report.noAccess')} />;

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const file = await certificatesApi.reportExport(from, to);
      saveBlob(file.blob, file.filename ?? `certificates-${from}-${to}.xlsx`);
      void message.success(t('certificates.report.exported'));
    } catch (error) {
      notifyError(error);
    } finally {
      setExporting(false);
    }
  };

  const data = report.data;
  return (
    <>
      <Flex gap={8} wrap align="center" style={{ marginBottom: 16 }}>
        <Typography.Text>{t('certificates.report.period')}</Typography.Text>
        <DateRangeFilter value={range} onChange={setRange} allowClear={false} />
        <Button icon={<DownloadOutlined />} loading={exporting} disabled={!range} onClick={() => void exportXlsx()}>
          {t('certificates.report.export')}
        </Button>
      </Flex>
      {report.error ? <ErrorAlert error={report.error} onRetry={() => void report.refetch()} /> : null}
      {report.isLoading ? <Spin style={{ display: 'block', margin: '48px auto' }} /> : null}
      {data ? (
        <Space direction="vertical" size={16} style={{ width: '100%', opacity: report.isPlaceholderData ? 0.6 : 1 }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={12} xl={8}>
              <Card size="small" style={{ height: '100%' }}>
                <Statistic title={t('certificates.report.issued')} value={t('certificates.report.issuedCount', { count: data.issued.count })} />
                {secondary(t('certificates.report.issuedNominal', { amount: money(data.issued.nominal) }))}
                {secondary(t('certificates.report.issuedRevenue', { amount: money(data.issued.price) }))}
              </Card>
            </Col>
            <Col xs={24} md={12} xl={8}>
              <MoneyStat
                title={t('certificates.report.redeemed')}
                value={data.redeemed.amount}
                extra={
                  <>
                    {secondary(t('certificates.report.redeemedOperations', { count: data.redeemed.operations }))}
                    {secondary(t('certificates.report.redeemedCertificates', { count: data.redeemed.certificates }))}
                  </>
                }
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <MoneyStat
                title={t('certificates.report.expired')}
                value={data.expired.amount}
                extra={
                  <>
                    {secondary(t('certificates.report.count', { count: data.expired.count }))}
                    {secondary(t('certificates.report.expiredHint'))}
                  </>
                }
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <MoneyStat
                title={t('certificates.report.returned')}
                value={data.returned.amount}
                extra={
                  <>
                    {secondary(t('certificates.report.count', { count: data.returned.count }))}
                    {secondary(t('certificates.report.returnedHint'))}
                  </>
                }
              />
            </Col>
            <Col xs={24} md={12} xl={8}>
              <MoneyStat
                title={t('certificates.report.reinstated')}
                value={data.reinstated.amount}
                extra={secondary(t('certificates.report.count', { count: data.reinstated.count }))}
              />
            </Col>
          </Row>
          <Card title={t('certificates.report.liability')}>
            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Statistic title={t('certificates.report.liabilityActive')} value={money(data.liability.active.amount)} />
                {secondary(t('certificates.report.count', { count: data.liability.active.count }))}
              </Col>
              <Col xs={24} md={12}>
                <Statistic title={t('certificates.report.liabilityBlocked')} value={money(data.liability.blocked.amount)} />
                {secondary(t('certificates.report.count', { count: data.liability.blocked.count }))}
              </Col>
            </Row>
          </Card>
        </Space>
      ) : null}
    </>
  );
}
