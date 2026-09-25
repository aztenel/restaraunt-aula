import { ShopOutlined } from '@ant-design/icons';
import { Card, Empty, Result } from 'antd';
import type { ReactNode } from 'react';
import type { Permission } from '@aula/api-client';
import { useAuth } from '@/shared/auth/AuthProvider';
import { branchesWith } from '@/shared/auth/permissions';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { Forbidden } from '@/shared/ui/Forbidden';

/**
 * Экран работает с одним филиалом (календарь, карта зала, залы и настройки). Если в шапке выбраны
 * «Все филиалы», предлагаем выбрать филиал — выбор меняет филиал в шапке для всех разделов.
 */
export function SingleBranchGate({
  permissions,
  title,
  text,
  none,
  children,
}: {
  /** Права, с которыми филиал можно открыть (хотя бы одно в филиале). */
  permissions: readonly Permission[];
  title: string;
  text: string;
  none: string;
  children: (branchId: string) => ReactNode;
}) {
  const { me } = useAuth();
  const { branches, selectedBranchId, setSelection, loading } = useBranch();
  const allowed = branches
    .map((b) => b.id)
    .filter((id) =>
      permissions.some((p) => {
        const scope = branchesWith(me, p);
        return scope === 'all' || scope.includes(id);
      }),
    );

  if (selectedBranchId) {
    return allowed.includes(selectedBranchId) || loading ? <>{children(selectedBranchId)}</> : <Forbidden />;
  }
  return (
    <Card>
      <Result
        icon={<ShopOutlined style={{ color: '#a5774f' }} />}
        title={title}
        subTitle={text}
        extra={
          allowed.length > 0 ? (
            <BranchSelect size="large" style={{ minWidth: 280 }} onlyIds={allowed} onChange={(id) => id && setSelection(id)} />
          ) : (
            <Empty description={none} />
          )
        }
      />
    </Card>
  );
}
