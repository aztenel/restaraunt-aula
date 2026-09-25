import { ArrowLeftOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { banquetsApi, banquetsKeys } from '../api';
import { InvoiceDetails } from './InvoiceDetails';

/** Карточка счёта (/banquets/invoices/:invoiceId): поступления, возвраты, отмена, PDF. */
export function InvoiceDetailPage() {
  const { t } = useTranslation();
  const { invoiceId = '' } = useParams();
  const invoice = useApiQuery(banquetsKeys.invoice(invoiceId), () => banquetsApi.invoice(invoiceId));
  return (
    <>
      <Link to="/banquets/invoices">
        <ArrowLeftOutlined /> {t('banquets.invoices.detail.back')}
      </Link>
      {invoice.isLoading ? <PageLoader /> : null}
      {invoice.error ? <ErrorAlert error={invoice.error} onRetry={() => void invoice.refetch()} /> : null}
      {invoice.data ? (
        <>
          <Typography.Title level={4} style={{ margin: '8px 0 16px' }}>
            {t('banquets.invoices.detail.title', { number: invoice.data.number })}
          </Typography.Title>
          <InvoiceDetails invoice={invoice.data} requestNumber={invoice.data.requestNumber} />
        </>
      ) : null}
    </>
  );
}
