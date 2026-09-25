import { Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/ui/PageHeader';
import { NotFoundPage } from '../common/NotFoundPage';
import { BranchMenuTab } from './branch-menu/BranchMenuTab';
import { CategoriesTab } from './categories/CategoriesTab';
import { DishEditorPage } from './dishes/DishEditorPage';
import { DishesTab } from './dishes/DishesTab';
import { ModifiersTab } from './modifiers/ModifiersTab';
import { useCatalogAbilities } from './useAbilities';

type MenuTab = 'dishes' | 'categories' | 'modifiers' | 'branch';
const TABS: MenuTab[] = ['dishes', 'categories', 'modifiers', 'branch'];

/**
 * Меню (menu.content / menu.prices / menu.stoplist): структура каталога сети — блюда, категории,
 * модификаторы (правит контент-менеджер, остальным — просмотр) и меню выбранного филиала — цены,
 * наличие, коды POS. Стоп-лист для точки — отдельный раздел /stop-list.
 */
export function MenuPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { editCatalog } = useCatalogAbilities();
  const segment = location.pathname.replace(/^\/menu\/?/, '').split('/')[0] as MenuTab | '';
  // Управляющему филиалом нужнее меню своей точки, контент-менеджеру — карточки блюд.
  const defaultTab: MenuTab = editCatalog ? 'dishes' : 'branch';

  return (
    <>
      <PageHeader title={t('nav.menu')} subtitle={t('sections.menu')} />
      <Tabs
        activeKey={segment || defaultTab}
        onChange={(key) => navigate(`/menu/${key}`)}
        items={TABS.map((key) => ({ key, label: t(`catalog.tabs.${key}`) }))}
        style={{ marginBottom: 8 }}
      />
      <Routes>
        <Route index element={<Navigate to={defaultTab} replace />} />
        <Route path="dishes" element={<DishesTab />} />
        <Route path="dishes/:id" element={<DishEditorPage />} />
        <Route path="categories" element={<CategoriesTab />} />
        <Route path="modifiers" element={<ModifiersTab />} />
        <Route path="branch" element={<BranchMenuTab />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
