import { Tabs } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/shared/auth/AuthProvider';
import { Forbidden } from '@/shared/ui/Forbidden';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { canViewContent, catalogAbilities } from '../menu/abilities';
import { BannersTab } from './banners/BannersTab';
import { PageEditorPage } from './pages/PageEditorPage';
import { PagesTab } from './pages/PagesTab';
import { PromotionsTab } from './promotions/PromotionsTab';
import { TranslationsTab } from './translations/TranslationsTab';

type ContentTab = 'banners' | 'promotions' | 'pages' | 'translations';

/**
 * Контент витрины (контент-менеджер, content.manage): баннеры, акции, страницы; отчёт о полноте
 * переводов (menu.content или content.manage). Вкладки — подмаршруты /content/<вкладка>.
 */
export function ContentPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const content = canViewContent(me);
  const translations = catalogAbilities(me).viewTranslations;
  const tabs: ContentTab[] = [...(content ? (['banners', 'promotions', 'pages'] as const) : []), ...(translations ? (['translations'] as const) : [])];
  const segment = location.pathname.replace(/^\/content\/?/, '').split('/')[0] as ContentTab | '';
  const first = tabs[0];

  const guard = (tab: ContentTab, element: ReactNode) => (tabs.includes(tab) ? element : <Forbidden />);

  return (
    <>
      <PageHeader title={t('nav.content')} subtitle={t('sections.content')} />
      <Tabs
        activeKey={segment || first}
        onChange={(key) => navigate(`/content/${key}`)}
        items={tabs.map((key) => ({ key, label: t(`content.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={first ? <Navigate to={first} replace /> : <Forbidden />} />
        <Route path="banners" element={guard('banners', <BannersTab />)} />
        <Route path="promotions" element={guard('promotions', <PromotionsTab />)} />
        <Route path="pages" element={guard('pages', <PagesTab />)} />
        <Route path="pages/:id" element={guard('pages', <PageEditorPage />)} />
        <Route path="translations" element={guard('translations', <TranslationsTab />)} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
