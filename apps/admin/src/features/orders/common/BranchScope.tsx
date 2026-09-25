import { ShopOutlined } from '@ant-design/icons';
import { Card, Empty, Result } from 'antd';
import type { ReactNode } from 'react';
import type { Permission } from '@aula/api-client';
import { useCan } from '@/shared/auth/useCan';
import { useBranch } from '@/shared/branch/BranchProvider';
import { BranchSelect } from '@/shared/ui/BranchSelect';

/** Филиалы (id), где у сотрудника есть право: глобальное право — все доступные филиалы. */
export function useBranchIdsWith(permission: Permission): string[] {
  const { branchesWith } = useCan();
  const { branches } = useBranch();
  const scope = branchesWith(permission);
  return scope === 'all' ? branches.map((b) => b.id) : branches.filter((b) => scope.includes(b.id)).map((b) => b.id);
}

/**
 * Экран работает с одним филиалом: выбранный в шапке филиал с нужным правом — рендерим children,
 * иначе предлагаем выбрать филиал (выбор меняет филиал в шапке для всех разделов).
 */
export function BranchScope({
  permission,
  title,
  text,
  none,
  children,
}: {
  permission: Permission;
  title: ReactNode;
  text?: ReactNode;
  none: ReactNode;
  children: (branchId: string) => ReactNode;
}) {
  const { selectedBranchId, setSelection, loading } = useBranch();
  const allowed = useBranchIdsWith(permission);
  if (selectedBranchId && (allowed.includes(selectedBranchId) || loading)) return <>{children(selectedBranchId)}</>;
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
