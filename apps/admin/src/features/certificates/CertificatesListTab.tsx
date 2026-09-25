import { PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { StatusTag } from '@/shared/ui/StatusTag';
import { formatLocalDate, useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import { CertificateDrawer } from './CertificateDrawer';
import { IssueCertificatesModal } from './IssueCertificatesModal';
import { CERTIFICATE_STATUSES, type Certificate, type CertificateListQuery, type CertificateStatus } from './types';

function contact(p: { name?: string | null; phone?: string | null; email?: string | null }) {
  if (!p.name && !p.phone && !p.email) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Space direction="vertical" size={0}>
      {p.name ? <span>{p.name}</span> : null}
      {p.phone || p.email ? <Typography.Text type="secondary">{p.phone ?? p.email}</Typography.Text> : null}
    </Space>
  );
}

/**
 * Выпущенные сертификаты (certificates.view): поиск по последним 4 символам кода, телефону покупателя
 * или получателя, статусу; ?orderId= — сертификаты заказа (ссылка из карточки платежа).
 * Строка открывает карточку с движениями и действиями.
 */
export function CertificatesListTab() {
  const { t, i18n } = useTranslation();
  const abilities = useCertificateAbilities();
  const [params, setParams] = useSearchParams();
  const certificateId = params.get('certificate');
  const orderId = params.get('orderId') ?? undefined;
  const [last4, setLast4] = useState('');
  const [phone, setPhone] = useState('');
  const [search, setSearch] = useState<{ q?: string; phone?: string }>({});
  const [status, setStatus] = useState<CertificateStatus | undefined>();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [issuing, setIssuing] = useState(false);

  const query: CertificateListQuery = useMemo(() => ({ ...search, status, orderId, page, perPage }), [search, status, orderId, page, perPage]);
  const list = useApiQuery(certificateKeys.list(query), () => certificatesApi.list(query), { keepPrevious: true });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const apply = () => {
    setSearch({ q: last4.trim() || undefined, phone: phone.trim() || undefined });
    setPage(1);
  };

  return (
    <>
      <Flex gap={8} wrap style={{ marginBottom: 16 }} justify="space-between">
        <Flex gap={8} wrap>
          <Input
            allowClear
            placeholder={t('certificates.list.searchLast4')}
            style={{ width: 230 }}
            value={last4}
            maxLength={14}
            onChange={(e) => setLast4(e.target.value.toUpperCase())}
            onPressEnter={apply}
          />
          <Input.Search
            allowClear
            placeholder={t('certificates.list.searchPhone')}
            style={{ width: 290 }}
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onSearch={apply}
            enterButton
          />
          <Select<CertificateStatus>
            allowClear
            placeholder={t('certificates.list.status')}
            style={{ width: 180 }}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            options={CERTIFICATE_STATUSES.map((value) => ({ value, label: t(`statuses.certificate.${value}`) }))}
          />
          {orderId ? (
            <Tag closable onClose={() => setParam('orderId', null)} style={{ display: 'flex', alignItems: 'center' }}>
              {t('certificates.list.order', { id: orderId.slice(0, 8) })}
            </Tag>
          ) : null}
          <Button
            onClick={() => {
              setLast4('');
              setPhone('');
              setSearch({});
              setStatus(undefined);
              setPage(1);
              if (orderId) setParam('orderId', null);
            }}
          >
            {t('common.reset')}
          </Button>
        </Flex>
        {abilities.issue ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setIssuing(true)}>
            {t('certificates.list.issue')}
          </Button>
        ) : null}
      </Flex>
      {list.error ? <ErrorAlert error={list.error} onRetry={() => void list.refetch()} /> : null}
      <PaginatedTable<Certificate>
        rowKey="id"
        data={list.data}
        loading={list.isLoading || list.isPlaceholderData}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        onRow={(c) => ({ onClick: () => setParam('certificate', c.id), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: t('certificates.list.columns.code'),
            key: 'code',
            render: (_, c) => (
              <div>
                <Typography.Link strong style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }} onClick={() => setParam('certificate', c.id)}>
                  {c.maskedCode}
                </Typography.Link>
                <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                  {translate(c.name, i18n.language)}
                </Typography.Text>
              </div>
            ),
          },
          {
            title: t('certificates.list.columns.kind'),
            key: 'kind',
            render: (_, c) => <Tag color={c.kind === 'set' ? 'purple' : 'blue'}>{t(`certificates.kind.${c.kind}`)}</Tag>,
          },
          {
            title: t('certificates.list.columns.status'),
            key: 'status',
            render: (_, c) =>
              c.statusReason ? (
                <Tooltip title={c.statusReason}>
                  <span>
                    <StatusTag domain="certificate" status={c.status} />
                  </span>
                </Tooltip>
              ) : (
                <StatusTag domain="certificate" status={c.status} />
              ),
          },
          {
            title: t('certificates.list.columns.balance'),
            key: 'balance',
            align: 'right',
            render: (_, c) => (
              <Space direction="vertical" size={0} align="end">
                <MoneyText value={c.balance} strong />
                <MoneyText value={c.nominal} type="secondary" />
              </Space>
            ),
          },
          { title: t('certificates.list.columns.validUntil'), key: 'validUntil', render: (_, c) => formatLocalDate(c.validUntil) },
          { title: t('certificates.list.columns.buyer'), key: 'buyer', render: (_, c) => contact(c.buyer) },
          { title: t('certificates.list.columns.recipient'), key: 'recipient', render: (_, c) => contact(c.recipient) },
          { title: t('certificates.list.columns.issuedAt'), key: 'issuedAt', render: (_, c) => formatDateTime(c.issuedAt) },
          {
            title: t('certificates.list.columns.delivery'),
            key: 'delivery',
            render: (_, c) => (
              <Space direction="vertical" size={0}>
                <span>{t(`certificates.deliveryChannel.${c.deliveryChannel}`)}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {c.deliveryCount > 0 ? t('certificates.list.deliveries', { count: c.deliveryCount }) : t('certificates.list.notSent')}
                </Typography.Text>
              </Space>
            ),
          },
        ]}
      />
      <CertificateDrawer certificateId={certificateId} onClose={() => setParam('certificate', null)} />
      {issuing ? <IssueCertificatesModal onClose={() => setIssuing(false)} /> : null}
    </>
  );
}
