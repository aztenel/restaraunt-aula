import { Card, Col, Flex, Row, Statistic, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatMoney, Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { DateRangeFilter, type DateRangeValue } from '@/shared/ui/DateRangeFilter';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import type { CustomerActivity, CustomerDetail } from '../types';

type TotalKey = Exclude<keyof CustomerDetail['totals'], 'spent' | 'activities'>;
const TOTALS: TotalKey[] = [
  'ordersPlaced',
  'ordersCompleted',
  'ordersCancelled',
  'ordersRefunded',
  'reservations',
  'noShows',
  'banquetRequests',
  'banquetsHeld',
  'certificatesPurchased',
];

/** Ссылка на объект события — только в разделы, доступные сотруднику. */
function useActivityLink() {
  const { canSomewhere } = useCan();
  return (activity: CustomerActivity): string | null => {
    switch (activity.entityType) {
      case 'order':
        return canSomewhere(Permission.OrdersView) ? `/orders/${activity.entityId}` : null;
      case 'banquet_request':
        return canSomewhere(Permission.BanquetsView) ? `/banquets/${activity.entityId}` : null;
      case 'banquet_invoice':
        return canSomewhere(Permission.BanquetsView) ? `/banquets/invoices/${activity.entityId}` : null;
      case 'gift_certificate':
        return canSomewhere(Permission.CertificatesView) ? `/certificates/list?certificate=${activity.entityId}` : null;
      default:
        return null;
    }
  };
}

/**
 * История гостя за период (заказы, брони, банкеты, сертификаты) и итоги периода — посчитаны сервером
 * из событий модулей. Период — локальные даты (включительно); без периода — за всё время.
 */
export function ActivityCard({
  detail,
  range,
  onRangeChange,
  page,
  perPage,
  onPageChange,
  loading,
}: {
  detail: CustomerDetail;
  range: DateRangeValue;
  onRangeChange: (range: DateRangeValue) => void;
  page: number;
  perPage: number;
  onPageChange: (page: number, perPage: number) => void;
  loading: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { branchName } = useBranch();
  const linkFor = useActivityLink();
  const { totals } = detail;

  return (
    <Card
      title={t('customers.activity.title')}
      extra={<DateRangeFilter value={range} onChange={onRangeChange} />}
    >
      <Typography.Text type="secondary">{range ? t('customers.activity.totals') : t('customers.activity.totalsAllTime')}</Typography.Text>
      <Row gutter={[16, 12]} style={{ margin: '8px 0 16px' }}>
        <Col xs={24} sm={12} lg={6}>
          <Statistic title={t('customers.activity.spent')} value={formatMoney(totals.spent, i18n.language)} />
        </Col>
        {TOTALS.map((key) => (
          <Col key={key} xs={12} sm={8} lg={6} xl={4}>
            <Statistic title={t(`customers.activity.${key}`)} value={totals[key]} />
          </Col>
        ))}
      </Row>
      <PaginatedTable<CustomerActivity>
        rowKey="id"
        size="small"
        data={detail.activities}
        loading={loading}
        page={page}
        perPage={perPage}
        onPageChange={onPageChange}
        locale={{ emptyText: t('customers.activity.empty') }}
        columns={[
          {
            title: t('customers.activity.columns.occurredAt'),
            key: 'occurredAt',
            render: (_, a) => <span style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.occurredAt)}</span>,
          },
          {
            title: t('customers.activity.columns.event'),
            key: 'event',
            render: (_, a) => {
              const link = linkFor(a);
              return (
                <div style={{ maxWidth: 420 }}>
                  <Typography.Text strong>{t(`customers.activity.types.${a.type}`)}</Typography.Text>
                  <Flex gap={8} wrap>
                    <Typography.Text type="secondary">{a.summary}</Typography.Text>
                    {link ? <Link to={link}>{t('customers.activity.open')}</Link> : null}
                  </Flex>
                </div>
              );
            },
          },
          { title: t('customers.activity.columns.branch'), key: 'branch', render: (_, a) => (a.branchId ? branchName(a.branchId) : '—') },
          {
            title: t('customers.activity.columns.amount'),
            key: 'amount',
            align: 'right',
            render: (_, a) =>
              a.amount ? (
                <div>
                  <MoneyText value={a.amount} type={a.countsAsSpent ? undefined : 'secondary'} strong={a.countsAsSpent} />
                  {!a.countsAsSpent ? (
                    <Typography.Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                      {t('customers.activity.notCounted')}
                    </Typography.Text>
                  ) : null}
                </div>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </Card>
  );
}
