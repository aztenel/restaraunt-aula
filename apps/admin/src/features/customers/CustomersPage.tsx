import { Tabs } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { ConsentTextsTab } from './ConsentTextsTab';
import { CustomersListTab } from './CustomersListTab';
import { CustomerDetailPage } from './detail/CustomerDetailPage';
import { SegmentsTab } from './SegmentsTab';

type CustomersTab = 'list' | 'segments' | 'consents';

const TAB_PATHS: Record<CustomersTab, string> = { list: '/customers', segments: '/customers/segments', consents: '/customers/consents' };

function CustomersShell({ tab, children }: { tab: CustomersTab; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title={t('nav.customers')} subtitle={t('sections.customers')} />
      <Tabs
        activeKey={tab}
        onChange={(key) => navigate(TAB_PATHS[key as CustomersTab])}
        items={(['list', 'segments', 'consents'] as const).map((key) => ({ key, label: t(`customers.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      {children}
    </>
  );
}

/**
 * База гостей (customers.view): список с фильтрами и сегментами, карточка гостя (/customers/:id),
 * сегменты для выгрузок, версии текстов согласий. Гости общие для сети — идентификатор телефон.
 */
export function CustomersPage() {
  return (
    <Routes>
      <Route
        index
        element={
          <CustomersShell tab="list">
            <CustomersListTab />
          </CustomersShell>
        }
      />
      <Route
        path="segments"
        element={
          <CustomersShell tab="segments">
            <SegmentsTab />
          </CustomersShell>
        }
      />
      <Route
        path="consents"
        element={
          <CustomersShell tab="consents">
            <ConsentTextsTab />
          </CustomersShell>
        }
      />
      <Route path=":id" element={<CustomerDetailPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
