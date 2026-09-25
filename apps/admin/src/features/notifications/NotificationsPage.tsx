/**
 * Уведомления: шаблоны (integrations.manage или content.manage — тексты это контент), журнал доставки,
 * каналы и тестовая отправка (только integrations.manage).
 */
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { ChannelsTab } from './ChannelsTab';
import { DeliveriesTab } from './DeliveriesTab';
import { TemplatesTab } from './TemplatesTab';

type NotificationsTab = 'templates' | 'deliveries' | 'channels';
const TABS: NotificationsTab[] = ['templates', 'deliveries', 'channels'];

export function NotificationsPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { can } = useCan();
  // Шаблоны и журнал — глобальные права (без филиала), как на сервере.
  const canIntegrations = can(Permission.IntegrationsManage);
  const canTemplates = canIntegrations || can(Permission.ContentManage);
  const tabs = TABS.filter((tab) => (tab === 'templates' ? canTemplates : canIntegrations));
  const segment = location.pathname.replace(/^\/notifications\/?/, '').split('/')[0] as NotificationsTab | '';
  const activeTab: NotificationsTab | undefined = tabs.includes(segment as NotificationsTab) ? (segment as NotificationsTab) : tabs[0];

  return (
    <>
      <PageHeader title={t('nav.notifications')} subtitle={t('sections.notifications')} />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => navigate(`/notifications/${key}`)}
        items={tabs.map((key) => ({ key, label: t(`notifications.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={activeTab ? <Navigate to={activeTab} replace /> : <NotFoundPage />} />
        <Route path="templates" element={canTemplates ? <TemplatesTab /> : <NotFoundPage />} />
        <Route path="deliveries" element={canIntegrations ? <DeliveriesTab /> : <NotFoundPage />} />
        <Route path="channels" element={canIntegrations ? <ChannelsTab /> : <NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
