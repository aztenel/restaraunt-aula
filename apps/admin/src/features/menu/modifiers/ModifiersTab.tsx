import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Space, Table, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { translate, type ModifierGroup } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyText } from '@/shared/ui/MoneyText';
import { bySortOrder } from '../reorder';
import { useCatalogAbilities } from '../useAbilities';
import { ModifierGroupDrawer } from './ModifierGroupDrawer';

/** Группы модификаторов (размер порции, соусы, добавки): список, создание, изменение, удаление. */
export function ModifiersTab() {
  const { t, i18n } = useTranslation();
  const { editCatalog } = useCatalogAbilities();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const groups = useQuery({ queryKey: queryKeys.modifierGroups, queryFn: catalogApi.modifierGroups });
  const list = useMemo(() => bySortOrder(groups.data ?? []), [groups.data]);
  const [drawer, setDrawer] = useState<{ open: boolean; group: ModifierGroup | null }>({ open: false, group: null });

  const editId = params.get('edit');
  useEffect(() => {
    if (!editId || !groups.data) return;
    const found = groups.data.find((g) => g.id === editId);
    if (found) setDrawer({ open: true, group: found });
  }, [editId, groups.data]);

  const close = () => {
    setDrawer({ open: false, group: null });
    if (editId) {
      params.delete('edit');
      setParams(params, { replace: true });
    }
  };

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{editCatalog ? t('catalog.modifiers.hint') : t('catalog.readOnly')}</Typography.Text>
        {editCatalog ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setDrawer({ open: true, group: null })}>
            {t('catalog.modifiers.create')}
          </Button>
        ) : null}
      </Flex>
      {groups.error ? <ErrorAlert error={groups.error} onRetry={() => void groups.refetch()} /> : null}
      <Table<ModifierGroup>
        rowKey="id"
        loading={groups.isLoading}
        dataSource={list}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('catalog.fields.name'),
            key: 'name',
            render: (_, g) => (
              <div>
                <Typography.Text strong>{translate(g.name, i18n.language)}</Typography.Text>
                <br />
                <Typography.Text type="secondary" code>
                  {g.code}
                </Typography.Text>
              </div>
            ),
          },
          {
            title: t('catalog.modifiers.rules'),
            key: 'rules',
            render: (_, g) => (
              <Space size={4} wrap>
                <Tag color={g.isRequired ? 'red' : 'default'}>{g.isRequired ? t('catalog.modifiers.required') : t('catalog.modifiers.optional')}</Tag>
                <Typography.Text type="secondary">{t('catalog.modifiers.selectRange', { min: g.minSelect, max: g.maxSelect })}</Typography.Text>
              </Space>
            ),
          },
          {
            title: t('catalog.modifiers.options'),
            key: 'options',
            render: (_, g) => (
              <Space size={[4, 4]} wrap style={{ maxWidth: 420 }}>
                {bySortOrder(g.options).map((o) => (
                  <Tag key={o.id} color={o.isDefault ? 'gold' : undefined} style={{ opacity: o.isActive ? 1 : 0.5 }}>
                    {translate(o.name, i18n.language)} · <MoneyText value={o.price} />
                  </Tag>
                ))}
              </Space>
            ),
          },
          { title: t('catalog.modifiers.dishes'), dataIndex: 'dishCount', align: 'right' },
          {
            title: t('catalog.fields.status'),
            dataIndex: 'isActive',
            render: (active: boolean) => <Tag color={active ? 'success' : 'default'}>{active ? t('common.active') : t('common.inactive')}</Tag>,
          },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, g) => (
              <Space size={4}>
                <Button size="small" icon={editCatalog ? <EditOutlined /> : <EyeOutlined />} onClick={() => setDrawer({ open: true, group: g })}>
                  {editCatalog ? t('common.edit') : t('catalog.view')}
                </Button>
                {editCatalog ? (
                  <ConfirmAction
                    danger
                    title={t('catalog.modifiers.deleteConfirm', { name: translate(g.name, i18n.language) })}
                    description={g.dishCount > 0 ? t('catalog.modifiers.deleteUsed', { count: g.dishCount }) : t('catalog.auditNote')}
                    buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                    successMessage={t('catalog.deleted')}
                    onConfirm={async () => {
                      await catalogApi.deleteModifierGroup(g.id);
                      await queryClient.invalidateQueries({ queryKey: queryKeys.modifierGroups });
                      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
                    }}
                  >
                    {t('common.delete')}
                  </ConfirmAction>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <ModifierGroupDrawer
        open={drawer.open}
        group={drawer.group}
        canEdit={editCatalog}
        onClose={close}
        onSaved={() => close()}
      />
    </>
  );
}
