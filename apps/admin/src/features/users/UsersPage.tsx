import { EditOutlined, KeyOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Flex, Input, Select, Space, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { STAFF_ROLES, type StaffUser } from '@aula/api-client';
import { usersApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { useAuth } from '@/shared/auth/AuthProvider';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PaginatedTable } from '@/shared/ui/PaginatedTable';
import { RolesModal } from './RolesModal';
import { TemporaryPasswordModal } from './TemporaryPasswordModal';
import { UserFormModal } from './UserFormModal';
import { useRoleDefinitions } from './useRoleDefinitions';

/** Пользователи и роли (право users.manage): список с фильтрами, создание, роли, сброс пароля. */
export function UsersPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { branchName } = useBranch();
  const { roleTitle } = useRoleDefinitions();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<string | undefined>();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [rolesFor, setRolesFor] = useState<StaffUser | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const params = useMemo(() => ({ q: search || undefined, role, branchId: branchId ?? undefined, page, perPage }), [search, role, branchId, page, perPage]);
  const usersQuery = useQuery({ queryKey: queryKeys.users(params), queryFn: () => usersApi.list(params), placeholderData: keepPreviousData });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'list'] });

  return (
    <>
      <PageHeader
        title={t('nav.users')}
        subtitle={t('sections.users')}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('users.create')}
          </Button>
        }
      />
      <Flex gap={8} wrap style={{ marginBottom: 16 }}>
        <Input.Search
          allowClear
          placeholder={t('users.searchPlaceholder')}
          style={{ width: 280 }}
          onSearch={(value) => {
            setSearch(value.trim());
            setPage(1);
          }}
        />
        <Select
          allowClear
          placeholder={t('users.role')}
          style={{ width: 220 }}
          value={role}
          onChange={(value) => {
            setRole(value);
            setPage(1);
          }}
          options={STAFF_ROLES.map((r) => ({ value: r, label: roleTitle(r) }))}
        />
        <BranchSelect
          allowClear
          style={{ width: 220 }}
          value={branchId}
          onChange={(value) => {
            setBranchId(value);
            setPage(1);
          }}
        />
      </Flex>
      {usersQuery.error ? <ErrorAlert error={usersQuery.error} onRetry={() => void usersQuery.refetch()} /> : null}
      <PaginatedTable<StaffUser>
        rowKey="id"
        data={usersQuery.data}
        loading={usersQuery.isFetching}
        page={page}
        perPage={perPage}
        onPageChange={(p, pp) => {
          setPage(p);
          setPerPage(pp);
        }}
        columns={[
          {
            title: t('users.name'),
            key: 'name',
            render: (_, user) => (
              <div>
                <Typography.Text strong>{user.name}</Typography.Text>
                <br />
                <Typography.Text type="secondary">{user.email}</Typography.Text>
                {user.phone ? (
                  <>
                    <br />
                    <Typography.Text type="secondary">{user.phone}</Typography.Text>
                  </>
                ) : null}
              </div>
            ),
          },
          {
            title: t('users.roles'),
            key: 'roles',
            render: (_, user) => (
              <Space size={[4, 4]} wrap>
                {user.roles.length === 0 ? <Typography.Text type="secondary">{t('users.noRoles')}</Typography.Text> : null}
                {user.roles.map((r) => (
                  <Tag key={`${r.role}:${r.branchId ?? ''}`} color={r.branchId ? 'blue' : 'gold'}>
                    {roleTitle(r.role)}
                    {r.branchId ? ` · ${branchName(r.branchId)}` : ''}
                  </Tag>
                ))}
              </Space>
            ),
          },
          {
            title: t('users.status'),
            key: 'status',
            render: (_, user) => (
              <Space size={4} wrap>
                <Tag color={user.isActive ? 'success' : 'default'}>{user.isActive ? t('common.active') : t('common.inactive')}</Tag>
                {user.mustChangePassword ? <Tag color="warning">{t('users.mustChangePassword')}</Tag> : null}
              </Space>
            ),
          },
          { title: t('users.lastLogin'), dataIndex: 'lastLoginAt', render: (value: string | null) => formatDateTime(value) },
          {
            title: t('common.actions'),
            key: 'actions',
            fixed: 'right',
            render: (_, user) => (
              <Space size={4} wrap>
                <Tooltip title={t('common.edit')}>
                  <Button size="small" icon={<EditOutlined />} aria-label={t('common.edit')} onClick={() => setEditing(user)} />
                </Tooltip>
                <Tooltip title={t('users.editRoles')}>
                  <Button size="small" icon={<SafetyCertificateOutlined />} aria-label={t('users.editRoles')} onClick={() => setRolesFor(user)} />
                </Tooltip>
                <ConfirmAction
                  title={t('users.resetPasswordConfirm', { name: user.name })}
                  description={t('users.resetPasswordDescription')}
                  buttonProps={{ size: 'small', icon: <KeyOutlined /> }}
                  onConfirm={async () => {
                    const result = await usersApi.resetPassword(user.id);
                    setTempPassword(result.temporaryPassword);
                    void refresh();
                  }}
                >
                  {t('users.resetPassword')}
                </ConfirmAction>
                {user.id !== me?.id ? (
                  <ConfirmAction
                    danger={user.isActive}
                    title={user.isActive ? t('users.deactivateConfirm', { name: user.name }) : t('users.activateConfirm', { name: user.name })}
                    description={user.isActive ? t('users.deactivateDescription') : undefined}
                    buttonProps={{ size: 'small' }}
                    successMessage={t('common.saved')}
                    onConfirm={async () => {
                      await usersApi.update(user.id, { isActive: !user.isActive });
                      await refresh();
                    }}
                  >
                    {user.isActive ? t('users.deactivate') : t('users.activate')}
                  </ConfirmAction>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <UserFormModal
        open={creating || editing !== null}
        user={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={(result) => {
          setCreating(false);
          setEditing(null);
          void refresh();
          void message.success(t('common.saved'));
          if (result.temporaryPassword) setTempPassword(result.temporaryPassword);
        }}
      />
      <RolesModal
        user={rolesFor}
        onClose={() => setRolesFor(null)}
        onSaved={() => {
          setRolesFor(null);
          void refresh();
          void message.success(t('common.saved'));
        }}
      />
      <TemporaryPasswordModal password={tempPassword} onClose={() => setTempPassword(null)} />
    </>
  );
}
