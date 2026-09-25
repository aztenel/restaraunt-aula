import { ShopOutlined } from '@ant-design/icons';
import { Card, Empty, Result } from 'antd';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { Forbidden } from '@/shared/ui/Forbidden';
import { branchesWithMenuAccess, MENU_READ_PERMISSIONS } from './abilities';

/**
 * Экран работает с одним филиалом (цены и стоп-лист — в разрезе филиала). Если в шапке выбраны
 * «Все филиалы», предлагаем выбрать филиал — выбор меняет филиал в шапке для всех разделов.
 */
export function BranchRequired({
  permissions = MENU_READ_PERMISSIONS,
  children,
}: {
  /** Права, с которыми филиал можно открыть (хотя бы одно в филиале). */
  permissions?: readonly Permission[];
  children: (branchId: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { branches, selectedBranchId, setSelection, loading } = useBranch();
  const allowed = branchesWithMenuAccess(
    me,
    branches.map((b) => b.id),
    permissions,
  );

  if (selectedBranchId) {
    return allowed.includes(selectedBranchId) || loading ? <>{children(selectedBranchId)}</> : <Forbidden />;
  }
  return (
    <Card>
      <Result
        icon={<ShopOutlined style={{ color: '#a5774f' }} />}
        title={t('catalog.branchRequired.title')}
        subTitle={t('catalog.branchRequired.text')}
        extra={
          allowed.length > 0 ? (
            <BranchSelect size="large" style={{ minWidth: 280 }} onlyIds={allowed} onChange={(id) => id && setSelection(id)} />
          ) : (
            <Empty description={t('catalog.branchRequired.none')} />
          )
        }
      />
    </Card>
  );
}
