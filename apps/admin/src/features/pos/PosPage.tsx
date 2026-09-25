/**
 * POS (integrations.manage или orders.manage): состояние интеграции по филиалам и синхронизация стоп-листа,
 * передачи заказов (очередь неудач, повтор), сопоставление блюд и номенклатура (только integrations.manage).
 */
import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { usePosAbilities } from './abilities';
import { PosExportsTab } from './PosExportsTab';
import { PosMappingsTab } from './PosMappingsTab';
import { PosProductsTab } from './PosProductsTab';
import { PosStatusTab } from './PosStatusTab';

type PosTab = 'status' | 'exports' | 'mappings' | 'products';
const TABS: PosTab[] = ['status', 'exports', 'mappings', 'products'];
const CONFIG_TABS: PosTab[] = ['mappings', 'products'];

export function PosPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { canIntegrations } = usePosAbilities();
  const tabs = TABS.filter((tab) => canIntegrations || !CONFIG_TABS.includes(tab));
  const segment = location.pathname.replace(/^\/pos\/?/, '').split('/')[0] as PosTab | '';
  const activeTab: PosTab = tabs.includes(segment as PosTab) ? (segment as PosTab) : 'status';

  return (
    <>
      <PageHeader title={t('nav.pos')} subtitle={t('sections.pos')} />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => navigate(`/pos/${key}`)}
        items={tabs.map((key) => ({ key, label: t(`pos.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={<Navigate to="status" replace />} />
        <Route path="status" element={<PosStatusTab />} />
        <Route path="exports" element={<PosExportsTab />} />
        <Route path="mappings" element={canIntegrations ? <PosMappingsTab /> : <NotFoundPage />} />
        <Route path="products" element={canIntegrations ? <PosProductsTab /> : <NotFoundPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
