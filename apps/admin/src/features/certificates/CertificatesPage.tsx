import { Tabs } from 'antd';
import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Forbidden } from '@/shared/ui/Forbidden';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { useCertificateAbilities } from './abilities';
import { CertificatesListTab } from './CertificatesListTab';
import { ProductsTab } from './ProductsTab';
import { RedeemTab } from './RedeemTab';
import { ReportTab } from './ReportTab';

type CertificatesTab = 'redeem' | 'list' | 'products' | 'report';

/**
 * Подарочные сертификаты: проверка и погашение на точке (планшет кассира), выпущенные сертификаты
 * (поиск, карточка с движениями, блокировка, продление, переотправка, выпуск по счёту), продукты и отчёт.
 * Вкладки — по правам (см. abilities.ts).
 */
export function CertificatesPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const abilities = useCertificateAbilities();
  const available: Record<CertificatesTab, boolean> = {
    redeem: abilities.check,
    list: abilities.view,
    products: abilities.products,
    report: abilities.report,
  };
  const tabs = (['redeem', 'list', 'products', 'report'] as const).filter((key) => available[key]);
  // Кассиру точки сначала нужен экран погашения, финансам и управляющему — список.
  const defaultTab: CertificatesTab | undefined = abilities.redeemSomewhere ? 'redeem' : tabs.find((key) => key !== 'redeem') ?? tabs[0];
  const segment = location.pathname.replace(/^\/certificates\/?/, '').split('/')[0] as CertificatesTab | '';
  const guard = (key: CertificatesTab, element: ReactElement) => (available[key] ? element : <Forbidden />);

  return (
    <>
      <PageHeader title={t('nav.certificates')} subtitle={t('sections.certificates')} />
      {tabs.length > 1 ? (
        <Tabs
          activeKey={segment || defaultTab}
          onChange={(key) => navigate(`/certificates/${key}`)}
          items={tabs.map((key) => ({ key, label: t(`certificates.tabs.${key}`) }))}
          style={{ marginBottom: 8 }}
        />
      ) : null}
      <Routes>
        <Route index element={defaultTab ? <Navigate to={defaultTab} replace /> : <Forbidden />} />
        <Route path="redeem" element={guard('redeem', <RedeemTab />)} />
        <Route path="list" element={guard('list', <CertificatesListTab />)} />
        <Route path="products" element={guard('products', <ProductsTab />)} />
        <Route path="report" element={guard('report', <ReportTab />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
