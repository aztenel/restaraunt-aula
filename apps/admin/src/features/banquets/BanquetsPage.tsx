import { Tabs } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Forbidden } from '@/shared/ui/Forbidden';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { useSectionAbilities } from './abilities';
import './banquets.css';
import { CalendarPage } from './calendar/CalendarPage';
import { CompaniesPage } from './companies/CompaniesPage';
import { InvoiceDetailPage } from './invoices/InvoiceDetailPage';
import { InvoicesPage } from './invoices/InvoicesPage';
import { PipelinePage } from './pipeline/PipelinePage';
import { QuoteEditorPage } from './quotes/QuoteEditorPage';
import { RequestDetailPage } from './request/RequestDetailPage';
import { SlaPage } from './sla/SlaPage';
import { TemplatesPage } from './templates/TemplatesPage';

type BanquetsTab = 'pipeline' | 'calendar' | 'invoices' | 'companies' | 'templates' | 'sla';
const TABS: BanquetsTab[] = ['pipeline', 'calendar', 'invoices', 'companies', 'templates', 'sla'];

/**
 * Банкеты и кейтеринг (banquets.view): воронка заявок, карточка заявки (/banquets/:id — ссылка из уведомлений),
 * конструктор сметы, счета, документы, компании-заказчики, шаблоны договоров, календарь мероприятий, SLA.
 * Вкладки — подмаршруты /banquets/<вкладка>; карточка заявки и редактор сметы — без вкладок.
 */
export function BanquetsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const abilities = useSectionAbilities();
  const segment = location.pathname.replace(/^\/banquets\/?/, '').split('/')[0] ?? '';
  const available: BanquetsTab[] = TABS.filter((tab) => {
    if (tab === 'companies') return abilities.companiesView;
    if (tab === 'templates') return abilities.templatesView;
    if (tab === 'invoices') return abilities.invoices;
    return true;
  });
  const isTab = segment === '' || (TABS as string[]).includes(segment);
  const guard = (tab: BanquetsTab, element: ReactNode) => (available.includes(tab) ? element : <Forbidden />);

  return (
    <>
      {isTab ? (
        <>
          <PageHeader title={t('nav.banquets')} subtitle={t('sections.banquets')} />
          <Tabs
            activeKey={segment || 'pipeline'}
            onChange={(key) => navigate(`/banquets/${key}`)}
            items={available.map((key) => ({ key, label: t(`banquets.tabs.${key}`) }))}
            style={{ marginBottom: 8 }}
          />
        </>
      ) : null}
      <Routes>
        <Route index element={<Navigate to="pipeline" replace />} />
        <Route path="pipeline" element={<PipelinePage />} />
        <Route path="calendar" element={<CalendarPage />} />
        <Route path="invoices" element={guard('invoices', <InvoicesPage />)} />
        <Route path="invoices/:invoiceId" element={guard('invoices', <InvoiceDetailPage />)} />
        <Route path="companies" element={guard('companies', <CompaniesPage />)} />
        <Route path="templates" element={guard('templates', <TemplatesPage />)} />
        <Route path="sla" element={<SlaPage />} />
        <Route path=":id" element={<RequestDetailPage />} />
        <Route path=":id/quote/new" element={<QuoteEditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
