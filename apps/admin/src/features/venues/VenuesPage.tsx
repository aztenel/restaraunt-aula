/**
 * Залы (venues.manage): залы и места филиала с планом зала (расстановка перетаскиванием), типы мест —
 * общий справочник сети с правилами брони по умолчанию, настройки брони филиала.
 */
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { HallsTab } from './HallsTab';
import { SettingsTab } from './SettingsTab';
import { VenueTypesTab } from './VenueTypesTab';
import '../reservations/reservations.css';

type VenuesTab = 'halls' | 'types' | 'settings';
const TABS: VenuesTab[] = ['halls', 'types', 'settings'];

export function VenuesPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const segment = location.pathname.replace(/^\/venues\/?/, '').split('/')[0] as VenuesTab | '';
  const activeTab: VenuesTab = TABS.includes(segment as VenuesTab) ? (segment as VenuesTab) : 'halls';

  return (
    <>
      <PageHeader title={t('nav.venues')} subtitle={t('sections.venues')} />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => navigate(`/venues/${key}`)}
        items={TABS.map((key) => ({ key, label: t(`venues.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={<Navigate to="halls" replace />} />
        <Route path="halls" element={<HallsTab />} />
        <Route path="types" element={<VenueTypesTab />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
