import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { PaymentDrawer } from './PaymentDrawer';
import { PaymentsListTab } from './PaymentsListTab';
import { RefundsQueueTab } from './RefundsQueueTab';

type PaymentsTab = 'list' | 'refunds';

/**
 * Платежи (payments.view): список с фильтрами и карточкой (возврат — payments.refund, отметка получения
 * денег — payments.manual), очередь возвратов с ручным подтверждением финансистом (payments.manual).
 * Карточка открывается по ?payment=<id> — ссылку можно передать коллеге.
 */
export function PaymentsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const paymentId = params.get('payment');
  const tab: PaymentsTab = location.pathname.replace(/^\/payments\/?/, '').startsWith('refunds') ? 'refunds' : 'list';

  const setPayment = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('payment', id);
    else next.delete('payment');
    setParams(next);
  };

  return (
    <>
      <PageHeader title={t('nav.payments')} subtitle={t('sections.payments')} />
      <Tabs
        activeKey={tab}
        onChange={(key) => navigate(key === 'refunds' ? '/payments/refunds' : '/payments')}
        items={(['list', 'refunds'] as const).map((key) => ({ key, label: t(`payments.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={<PaymentsListTab onOpen={setPayment} />} />
        <Route path="refunds" element={<RefundsQueueTab onOpenPayment={setPayment} />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <PaymentDrawer paymentId={paymentId} onClose={() => setPayment(null)} />
    </>
  );
}
