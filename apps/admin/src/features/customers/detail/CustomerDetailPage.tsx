import { ArrowLeftOutlined, UserDeleteOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Col, Row, Space, Spin, Statistic, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router';
import { formatMoney, Permission } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useCan } from '@/shared/auth/useCan';
import { formatDate, formatDateTime } from '@/shared/lib/dates';
import type { DateRangeValue } from '@/shared/ui/DateRangeFilter';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { customerKeys, customersApi, type CustomerDetailQuery } from '../api';
import { CustomerTags } from '../CustomerTags';
import type { Customer } from '../types';
import { ActivityCard } from './ActivityCard';
import { AnonymizeModal } from './AnonymizeModal';
import { ConsentsCard } from './ConsentsCard';
import { ProfileCard } from './ProfileCard';

function StatsCard({ customer }: { customer: Customer }) {
  const { t, i18n } = useTranslation();
  const small = (text: string) => (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {text}
    </Typography.Text>
  );
  return (
    <Card size="small">
      <Row gutter={[16, 12]}>
        <Col xs={24} sm={12} lg={6}>
          <Statistic title={t('customers.detail.stats.spent')} value={formatMoney(customer.totalSpent, i18n.language)} />
        </Col>
        <Col xs={8} sm={4} lg={3}>
          <Statistic title={t('customers.detail.stats.orders')} value={customer.ordersCount} />
          {small(t('customers.detail.stats.completed', { count: customer.completedOrdersCount }))}
        </Col>
        <Col xs={8} sm={4} lg={3}>
          <Statistic title={t('customers.detail.stats.reservations')} value={customer.reservationsCount} />
          {customer.noShowCount > 0 ? small(t('customers.detail.stats.noShows', { count: customer.noShowCount })) : null}
        </Col>
        <Col xs={8} sm={4} lg={3}>
          <Statistic title={t('customers.detail.stats.banquets')} value={customer.banquetsCount} />
        </Col>
        <Col xs={12} sm={12} lg={4}>
          <Statistic title={t('customers.detail.stats.firstSeen')} value={formatDate(customer.firstSeenAt)} valueStyle={{ fontSize: 18 }} />
        </Col>
        <Col xs={12} sm={12} lg={5}>
          <Statistic title={t('customers.detail.stats.lastActivity')} value={formatDateTime(customer.lastActivityAt)} valueStyle={{ fontSize: 18 }} />
        </Col>
      </Row>
    </Card>
  );
}

/**
 * Карточка гостя: профиль и теги, аллергии и предпочтения, согласия (история, фиксация сотрудником),
 * история заказов/броней/банкетов/сертификатов с итогами за период, обезличивание по требованию гостя.
 */
export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { canSomewhere } = useCan();
  const [range, setRange] = useState<DateRangeValue>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [anonymizing, setAnonymizing] = useState(false);

  const query: CustomerDetailQuery = {
    from: range?.[0].format('YYYY-MM-DD'),
    to: range?.[1].format('YYYY-MM-DD'),
    page,
    perPage,
  };
  const detail = useApiQuery(customerKeys.detail(id, query), () => customersApi.get(id, query), { keepPrevious: true, enabled: Boolean(id) });
  const data = detail.data;
  const customer = data?.customer;
  const anonymized = Boolean(customer?.anonymizedAt);
  const editable = canSomewhere(Permission.CustomersManage) && !anonymized;
  const backTo = (location.state as { from?: string } | null)?.from ?? '/customers';

  return (
    <>
      <PageHeader
        title={
          <Space size={12} wrap>
            <Button icon={<ArrowLeftOutlined />} aria-label={t('customers.detail.back')} onClick={() => navigate(backTo)} />
            <span>{customer ? (anonymized ? t('customers.detail.anonymizedTitle') : customer.phone) : '…'}</span>
          </Space>
        }
        subtitle={customer && !anonymized ? customer.name || t('customers.list.noName') : undefined}
        extra={
          editable && customer ? (
            <Button danger icon={<UserDeleteOutlined />} onClick={() => setAnonymizing(true)}>
              {t('customers.anonymize.button')}
            </Button>
          ) : null
        }
      />
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {detail.isLoading ? <Spin style={{ display: 'block', margin: '48px auto' }} /> : null}
      {data && customer ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {anonymized ? <Alert type="warning" showIcon message={t('customers.detail.anonymizedBanner', { date: formatDateTime(customer.anonymizedAt) })} /> : null}
          <CustomerTags tags={customer.tags} />
          <StatsCard customer={customer} />
          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <ProfileCard customer={customer} editable={editable} />
            </Col>
            <Col xs={24} xl={12}>
              <ConsentsCard customer={customer} consents={data.consents} editable={editable} />
            </Col>
          </Row>
          <ActivityCard
            detail={data}
            range={range}
            onRangeChange={(next) => {
              setRange(next);
              setPage(1);
            }}
            page={page}
            perPage={perPage}
            onPageChange={(p, pp) => {
              setPage(p);
              setPerPage(pp);
            }}
            loading={detail.isPlaceholderData}
          />
        </Space>
      ) : null}
      {anonymizing && customer ? <AnonymizeModal customer={customer} onClose={() => setAnonymizing(false)} /> : null}
    </>
  );
}
