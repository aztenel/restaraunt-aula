import { OrderedListOutlined, PhoneOutlined, ProjectOutlined } from '@ant-design/icons';
import { Segmented } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes, useLocation, useNavigate } from 'react-router';
import { Permission } from '@aula/api-client';
import { RequirePermission } from '@/shared/auth/RequirePermission';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { PageHeader } from '@/shared/ui/PageHeader';
import { OrderDetailPage } from './detail/OrderDetailPage';
import { OrdersListPage } from './list/OrdersListPage';
import { PhoneOrderPage } from './phone/PhoneOrderPage';
import { OrdersQueuePage } from './queue/OrdersQueuePage';

type Tab = 'queue' | 'list' | 'new';

const TAB_PATHS: Record<Tab, string> = { queue: '/orders', list: '/orders/list', new: '/orders/new' };

function currentTab(pathname: string): Tab | null {
  if (pathname === '/orders' || pathname === '/orders/') return 'queue';
  if (pathname.startsWith('/orders/list')) return 'list';
  if (pathname.startsWith('/orders/new')) return 'new';
  return null;
}

/** Шапка раздела заказов: вкладки «Очередь» / «Все заказы» / «Заказ по телефону». */
function OrdersShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { canSomewhere } = useCan();
  const { selectedBranchId, branchName } = useBranch();
  const tab = currentTab(pathname) ?? 'queue';
  const options: Array<{ value: Tab; label: ReactNode; icon: ReactNode }> = [
    { value: 'queue', label: t('orders.tabs.queue'), icon: <ProjectOutlined /> },
    { value: 'list', label: t('orders.tabs.list'), icon: <OrderedListOutlined /> },
    ...(canSomewhere(Permission.OrdersManage) ? [{ value: 'new' as const, label: t('orders.tabs.create'), icon: <PhoneOutlined /> }] : []),
  ];
  const titles: Record<Tab, string> = { queue: t('orders.queue.title'), list: t('orders.tabs.list'), new: t('orders.phone.title') };
  const subtitles: Record<Tab, string> = { queue: t('orders.queue.subtitle'), list: t('sections.orders'), new: t('orders.phone.subtitle') };

  return (
    <>
      <PageHeader
        title={`${titles[tab]} · ${selectedBranchId ? branchName(selectedBranchId) : t('layout.allBranches')}`}
        subtitle={subtitles[tab]}
        extra={<Segmented<Tab> size="large" value={tab} onChange={(value) => navigate(TAB_PATHS[value])} options={options} />}
      />
      {children}
    </>
  );
}

/**
 * Раздел «Заказы»: очередь оператора (главный экран смены), список с фильтрами, заказ по телефону
 * и карточка заказа (/orders/:id — ссылки из уведомлений и журнала).
 */
export function OrdersPage() {
  return (
    <Routes>
      <Route
        index
        element={
          <OrdersShell>
            <OrdersQueuePage />
          </OrdersShell>
        }
      />
      <Route
        path="list"
        element={
          <OrdersShell>
            <OrdersListPage />
          </OrdersShell>
        }
      />
      <Route
        path="new"
        element={
          <RequirePermission anyOf={[Permission.OrdersManage]}>
            <OrdersShell>
              <PhoneOrderPage />
            </OrdersShell>
          </RequirePermission>
        }
      />
      <Route path=":id" element={<OrderDetailPage />} />
    </Routes>
  );
}
