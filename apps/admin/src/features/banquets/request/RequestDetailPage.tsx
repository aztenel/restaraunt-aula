import { ArrowLeftOutlined, EditOutlined, MailOutlined, PhoneOutlined, UserOutlined } from '@ant-design/icons';
import { Badge, Button, Card, Col, Descriptions, Row, Space, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams, useSearchParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { formatDateTime } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageLoader } from '@/shared/ui/PageLoader';
import { StatusTag } from '@/shared/ui/StatusTag';
import { useRequestAbilities } from '../abilities';
import { banquetsApi, banquetsKeys } from '../api';
import { ManagerSelect } from '../common/ManagerSelect';
import { formatEventDate } from '../common/format';
import { EventTypeLabel, PlaceTag, SlaTimer, useNow } from '../common/ui';
import { DocumentsTab } from '../documents/DocumentsTab';
import { RequestInvoicesTab } from '../invoices/RequestInvoicesTab';
import { QuotesTab } from '../quotes/QuotesTab';
import { isOpenRequest } from '../request-actions';
import { firstResponseInfo } from '../sla';
import type { BanquetRequestDetail } from '../types';
import { ActivityTimeline } from './ActivityTimeline';
import { PrepaymentCard } from './PrepaymentCard';
import { RequestActions } from './RequestActions';
import { RequestFormDrawer } from './RequestFormDrawer';
import { useRequestMutation } from './useRequestMutation';
import { VenueHoldCard } from './VenueHoldCard';

type DetailTab = 'overview' | 'quote' | 'invoices' | 'documents';
const DETAIL_TABS: DetailTab[] = ['overview', 'quote', 'invoices', 'documents'];

function ManagerCard({ request, canManage }: { request: BanquetRequestDetail; canManage: boolean }) {
  const { t } = useTranslation();
  const assign = useRequestMutation((managerId: string) => banquetsApi.assign(request.id, managerId), { successMessage: t('banquets.detail.reassigned') });
  return (
    <Card
      size="small"
      title={
        <Space>
          <UserOutlined />
          {t('banquets.detail.manager')}
        </Space>
      }
    >
      {canManage && isOpenRequest(request) ? (
        <ManagerSelect
          value={request.managerId}
          onChange={(managerId) => {
            if (managerId && managerId !== request.managerId) assign.mutate(managerId);
          }}
          loading={assign.isPending}
          disabled={assign.isPending}
          style={{ width: '100%' }}
          aria-label={t('banquets.detail.reassign')}
        />
      ) : (
        <Typography.Text strong>{request.managerName}</Typography.Text>
      )}
    </Card>
  );
}

function OverviewTab({ request, canManage, now }: { request: BanquetRequestDetail; canManage: boolean; now: number }) {
  const { t } = useTranslation();
  const response = firstResponseInfo(request);
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={15}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Card size="small" title={t('banquets.detail.event')}>
            <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label={t('banquets.common.eventType')}>
                <EventTypeLabel type={request.eventType} />
              </Descriptions.Item>
              <Descriptions.Item label={t('banquets.common.eventDate')}>{formatEventDate(request.eventDate, request.eventTime)}</Descriptions.Item>
              <Descriptions.Item label={t('banquets.common.guests')}>{request.guests}</Descriptions.Item>
              <Descriptions.Item label={t('banquets.common.budget')}>
                <MoneyText value={request.budget} />
              </Descriptions.Item>
              <Descriptions.Item label={t('banquets.common.branch')} span={2}>
                <Space wrap>
                  <PlaceTag isOffsite={request.isOffsite} branchName={request.branchName} offsiteAddress={request.offsiteAddress} />
                  {request.isOffsite && request.offsiteAddress ? <span>{request.offsiteAddress}</span> : null}
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label={t('banquets.detail.firstResponse')} span={2}>
                <Space wrap>
                  {response ? (
                    <Typography.Text type={response.withinSla ? 'success' : 'danger'}>
                      {response.withinSla ? t('banquets.sla.answered', { minutes: response.minutes }) : t('banquets.sla.answeredLate', { minutes: response.minutes })}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary">{t('banquets.detail.noResponse')}</Typography.Text>
                  )}
                  <SlaTimer subject={request} now={now} showBreachedFlag />
                </Space>
              </Descriptions.Item>
              {request.wishes ? (
                <Descriptions.Item label={t('banquets.detail.wishes')} span={2}>
                  <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{request.wishes}</Typography.Paragraph>
                </Descriptions.Item>
              ) : null}
              {request.cancelReason ? (
                <Descriptions.Item label={t('banquets.detail.cancelReason')} span={2}>
                  <Typography.Text type="danger">{request.cancelReason}</Typography.Text>
                  {request.cancelledAt ? <Typography.Text type="secondary"> · {formatDateTime(request.cancelledAt)}</Typography.Text> : null}
                </Descriptions.Item>
              ) : null}
              {request.heldAt ? <Descriptions.Item label={t('banquets.detail.heldAt')}>{formatDateTime(request.heldAt)}</Descriptions.Item> : null}
            </Descriptions>
          </Card>
          <Card size="small" title={t('banquets.detail.customer')}>
            <Row gutter={[16, 8]}>
              <Col xs={24} md={10}>
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{request.contact.name}</Typography.Text>
                  <a href={`tel:${request.contact.phone}`}>
                    <PhoneOutlined /> {request.contact.phone}
                  </a>
                  {request.contact.email ? (
                    <a href={`mailto:${request.contact.email}`}>
                      <MailOutlined /> {request.contact.email}
                    </a>
                  ) : null}
                </Space>
              </Col>
              <Col xs={24} md={14}>
                <Typography.Text type="secondary">{t('banquets.detail.company')}</Typography.Text>
                {request.company ? (
                  <Space direction="vertical" size={0} style={{ display: 'flex' }}>
                    <Typography.Text strong>{request.company.name}</Typography.Text>
                    <span>
                      {t('banquets.companies.fields.bin')} {request.company.bin}
                    </span>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {request.company.legalAddress}
                    </Typography.Text>
                    {request.company.iban ? (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {request.company.bankName ?? ''} {request.company.iban} {request.company.bik ?? ''}
                      </Typography.Text>
                    ) : null}
                  </Space>
                ) : (
                  <div>{t('banquets.detail.noCompany')}</div>
                )}
              </Col>
            </Row>
          </Card>
          <VenueHoldCard request={request} canManage={canManage} />
          <PrepaymentCard request={request} canManage={canManage} />
        </Space>
      </Col>
      <Col xs={24} xl={9}>
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <ManagerCard request={request} canManage={canManage} />
          <ActivityTimeline requestId={request.id} timeline={request.timeline} canAdd={canManage && isOpenRequest(request)} />
        </Space>
      </Col>
    </Row>
  );
}

/** Карточка банкетной заявки (/banquets/:id): статус и действия воронки, детали, смета, счета, документы. */
export function RequestDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const detail = useApiQuery(banquetsKeys.detail(id), () => banquetsApi.get(id), { refetchInterval: 60_000 });
  const request = detail.data;
  const abilities = useRequestAbilities(request?.branchId);
  const now = useNow(1000, request?.status === 'new' && !request.firstResponseAt);
  const tabParam = params.get('tab') as DetailTab | null;
  const tab: DetailTab = tabParam && DETAIL_TABS.includes(tabParam) ? tabParam : 'overview';

  if (detail.isLoading) return <PageLoader />;
  if (detail.error || !request) {
    return (
      <>
        <Link to="/banquets/pipeline">
          <ArrowLeftOutlined /> {t('banquets.detail.back')}
        </Link>
        <div style={{ marginTop: 12 }}>
          <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} />
        </div>
      </>
    );
  }

  const canManage = abilities.manage;
  const setTab = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    next.delete('quote');
    setParams(next, { replace: true });
  };

  return (
    <>
      <Link to="/banquets/pipeline">
        <ArrowLeftOutlined /> {t('banquets.detail.back')}
      </Link>
      <PageHeader
        title={
          <Space wrap size={8}>
            <span>{request.number}</span>
            <StatusTag domain="banquet" status={request.status} />
            <SlaTimer subject={request} now={now} />
            <Tag>{t(`banquets.sources.${request.source}`)}</Tag>
          </Space>
        }
        subtitle={
          <Space wrap size={6}>
            <EventTypeLabel type={request.eventType} />
            <span>·</span>
            <span>{formatEventDate(request.eventDate, request.eventTime)}</span>
            <span>·</span>
            <span>{t('banquets.common.guestsCount', { count: request.guests })}</span>
            <span>·</span>
            <span>{request.contact.name}</span>
            <span>·</span>
            <span>{t('banquets.detail.created', { date: formatDateTime(request.createdAt) })}</span>
          </Space>
        }
        extra={
          <>
            <RequestActions request={request} canManage={canManage} />
            {canManage && isOpenRequest(request) ? (
              <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
                {t('banquets.detail.edit')}
              </Button>
            ) : null}
          </>
        }
      />
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: t('banquets.detail.tabs.overview'), children: <OverviewTab request={request} canManage={canManage} now={now} /> },
          {
            key: 'quote',
            label: (
              <Space size={6}>
                {t('banquets.detail.tabs.quote')}
                {request.quoteVersion ? <Badge count={`v${request.quoteVersion}`} color="#8a5a36" /> : null}
              </Space>
            ),
            children: <QuotesTab request={request} />,
          },
          {
            key: 'invoices',
            label: (
              <Space size={6}>
                {t('banquets.detail.tabs.invoices')}
                {request.invoices.length > 0 ? <Badge count={request.invoices.length} color="#a08b76" /> : null}
              </Space>
            ),
            children: <RequestInvoicesTab request={request} canInvoice={abilities.invoice} />,
          },
          {
            key: 'documents',
            label: (
              <Space size={6}>
                {t('banquets.detail.tabs.documents')}
                {request.documents.length > 0 ? <Badge count={request.documents.length} color="#a08b76" /> : null}
              </Space>
            ),
            children: <DocumentsTab request={request} canIssue={abilities.documents} />,
          },
        ]}
      />
      <RequestFormDrawer open={editing} request={request} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
    </>
  );
}
