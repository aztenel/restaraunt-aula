import { MenuFoldOutlined, MenuUnfoldOutlined } from '@ant-design/icons';
import { Badge, Button, Flex, Grid, Layout, Menu, type MenuProps } from 'antd';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useCan } from '@/shared/auth/useCan';
import { FeedProvider, useAdminFeed } from '@/shared/feed/FeedProvider';
import { useStoredState } from '@/shared/lib/storage';
import { PageLoader } from '@/shared/ui/PageLoader';
import { SECTION_GROUPS, SECTIONS, sectionForPath } from '../navigation';
import { BranchSwitcher, FeedIndicator, LanguageSwitcher, UserMenu } from './HeaderControls';
import { Brand } from './Brand';

function SideMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { canAny } = useCan();
  const { unread, markRead } = useAdminFeed();
  const navigate = useNavigate();
  const location = useLocation();
  const current = sectionForPath(location.pathname);

  // Открыли раздел очереди — события этой очереди прочитаны.
  useEffect(() => {
    if (current?.stream) markRead(current.stream);
  }, [current?.stream, markRead, location.pathname]);

  const items = useMemo<MenuProps['items']>(
    () =>
      SECTION_GROUPS.map((group) => {
        const children = SECTIONS.filter((s) => s.group === group && (!s.anyOf || canAny(s.anyOf))).map((s) => ({
          key: s.path,
          icon: s.icon,
          label: (
            <Flex justify="space-between" align="center" gap={8}>
              <span>{t(`nav.${s.key}`)}</span>
              {s.stream && unread[s.stream] > 0 ? <Badge count={unread[s.stream]} size="small" /> : null}
            </Flex>
          ),
        }));
        return children.length > 0 ? { type: 'group' as const, key: group, label: t(`nav.groups.${group}`), children } : null;
      }).filter((item) => item !== null),
    [canAny, t, unread],
  );

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={current ? [current.path] : []}
      items={items}
      onClick={({ key }) => {
        navigate(key);
        onNavigate?.();
      }}
    />
  );
}

/** Каркас админки: меню разделов по правам, шапка с переключателем филиала, язык, звук, профиль. */
export function AdminLayout() {
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.lg;
  const [collapsedDesktop, setCollapsedDesktop] = useStoredState('aula_admin_sider_collapsed', false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const collapsed = isMobile ? !mobileOpen : collapsedDesktop;
  const { t } = useTranslation();

  return (
    <FeedProvider>
      <Layout style={{ minHeight: '100dvh' }}>
        <Layout.Sider
          width={236}
          collapsible
          collapsed={collapsed}
          collapsedWidth={isMobile ? 0 : 72}
          trigger={null}
          style={isMobile ? { position: 'fixed', insetBlock: 0, left: 0, zIndex: 20, overflow: 'auto' } : { overflow: 'auto' }}
        >
          <Brand collapsed={collapsed && !isMobile} />
          <SideMenu onNavigate={isMobile ? () => setMobileOpen(false) : undefined} />
        </Layout.Sider>
        {isMobile && mobileOpen ? (
          <div
            role="presentation"
            onClick={() => setMobileOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 15 }}
          />
        ) : null}
        <Layout>
          <Layout.Header style={{ position: 'sticky', top: 0, zIndex: 10, borderBottom: '1px solid #ede0d0' }}>
            <Flex align="center" justify="space-between" gap={8} style={{ height: '100%' }}>
              <Flex align="center" gap={8} style={{ minWidth: 0 }}>
                <Button
                  type="text"
                  aria-label={collapsed ? t('layout.expand') : t('layout.collapse')}
                  icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => (isMobile ? setMobileOpen(!mobileOpen) : setCollapsedDesktop(!collapsedDesktop))}
                />
                <BranchSwitcher />
              </Flex>
              <Flex align="center" gap={4}>
                <FeedIndicator />
                <LanguageSwitcher />
                <UserMenu />
              </Flex>
            </Flex>
          </Layout.Header>
          <Layout.Content style={{ padding: isMobile ? 12 : 24, minWidth: 0 }}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </Layout.Content>
        </Layout>
      </Layout>
    </FeedProvider>
  );
}
