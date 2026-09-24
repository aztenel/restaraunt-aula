import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Select, Tag, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { STAFF_ROLES, type RoleAssignment, type StaffRole } from '@aula/api-client';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { roleScope } from './roles';
import { useRoleDefinitions } from './useRoleDefinitions';

type Draft = Partial<RoleAssignment>;

/**
 * Редактор ролей пользователя: роль привязана к филиалу (филиальные роли) или глобальная.
 * Совместим с Form.Item (value/onChange).
 */
export function RolesEditor({ value = [], onChange }: { value?: Draft[]; onChange?: (value: Draft[]) => void }) {
  const { t } = useTranslation();
  const { definitions, roleTitle } = useRoleDefinitions();

  const update = (index: number, patch: Draft) => {
    const next = value.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange?.(next);
  };

  return (
    <Flex vertical gap={8}>
      {value.length === 0 ? <Typography.Text type="secondary">{t('users.noRoles')}</Typography.Text> : null}
      {value.map((row, index) => {
        const scope = row.role ? roleScope(row.role, definitions) : null;
        return (
          <Flex key={index} gap={8} wrap align="center">
            <Select<StaffRole>
              aria-label={t('users.role')}
              style={{ minWidth: 220, flex: '1 1 220px' }}
              placeholder={t('users.role')}
              value={row.role}
              onChange={(role) =>
                update(index, { role, branchId: roleScope(role, definitions) === 'branch' ? (row.branchId ?? null) : null })
              }
              options={STAFF_ROLES.map((role) => ({
                value: role,
                label: (
                  <Flex justify="space-between" gap={8}>
                    <span>{roleTitle(role)}</span>
                    <Tag bordered={false} color={roleScope(role, definitions) === 'global' ? 'gold' : 'blue'}>
                      {t(`users.scope.${roleScope(role, definitions)}`)}
                    </Tag>
                  </Flex>
                ),
              }))}
            />
            {scope === 'branch' ? (
              <BranchSelect
                aria-label={t('layout.branch')}
                style={{ minWidth: 200, flex: '1 1 200px' }}
                value={row.branchId ?? null}
                status={row.branchId ? undefined : 'error'}
                onChange={(branchId) => update(index, { branchId })}
              />
            ) : scope === 'global' ? (
              <Typography.Text type="secondary" style={{ flex: '1 1 200px' }}>
                {t('users.allBranchesScope')}
              </Typography.Text>
            ) : null}
            <Button
              aria-label={t('common.delete')}
              icon={<DeleteOutlined />}
              onClick={() => onChange?.(value.filter((_, i) => i !== index))}
            />
          </Flex>
        );
      })}
      <Button icon={<PlusOutlined />} onClick={() => onChange?.([...value, { role: undefined, branchId: null }])} style={{ alignSelf: 'flex-start' }}>
        {t('users.addRole')}
      </Button>
    </Flex>
  );
}
