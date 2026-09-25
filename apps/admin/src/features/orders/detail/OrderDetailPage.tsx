import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card } from 'antd';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageLoader } from '@/shared/ui/PageLoader';
import { ordersApi, ordersKeys } from '../api';
import { OrderDetailsView } from './OrderDetailsView';

/** Заказ на отдельной странице (/orders/:id) — ссылки из уведомлений персоналу и журнала действий. */
export function OrderDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const detail = useApiQuery(ordersKeys.detail(id), () => ordersApi.get(id), { enabled: id !== '' });

  return (
    <>
      <PageHeader
        title={detail.data ? t('orders.detail.title', { number: detail.data.number }) : t('nav.orders')}
        extra={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/orders')}>
              {t('orders.detail.back')}
            </Button>
            <Button icon={<ReloadOutlined />} loading={detail.isFetching} onClick={() => void detail.refetch()} aria-label={t('common.refresh')} />
          </>
        }
      />
      {detail.error ? <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} /> : null}
      {detail.isLoading ? <PageLoader /> : null}
      {detail.data ? (
        <Card>
          <OrderDetailsView order={detail.data} />
        </Card>
      ) : null}
    </>
  );
}
