import { DeleteOutlined, EditOutlined, EyeOutlined, LockOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Flex, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { translate, type ContentPage } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { bySortOrder } from '../../menu/reorder';
import { useContentAbilities } from '../useContentAbilities';

/** Статические страницы витрины; юридические (оферта, политика) защищены от удаления. */
export function PagesTab() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pages: canEdit } = useContentAbilities();
  const pages = useQuery({ queryKey: queryKeys.pages, queryFn: contentApi.pages });

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">{canEdit ? t('content.pages.hint') : t('content.pages.readOnly')}</Typography.Text>
        {canEdit ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/content/pages/new')}>
            {t('content.pages.create')}
          </Button>
        ) : null}
      </Flex>
      {pages.error ? <ErrorAlert error={pages.error} onRetry={() => void pages.refetch()} /> : null}
      <Table<ContentPage>
        rowKey="id"
        loading={pages.isLoading}
        dataSource={bySortOrder(pages.data ?? [])}
        pagination={false}
        scroll={{ x: 'max-content' }}
        columns={[
          {
            title: t('content.fields.title'),
            key: 'title',
            render: (_, p) => (
              <div>
                <Link to={`/content/pages/${p.id}`}>
                  <Typography.Text strong>{translate(p.title, i18n.language)}</Typography.Text>
                </Link>{' '}
                {p.isProtected ? (
                  <Tooltip title={t('content.pages.protectedHint')}>
                    <Tag icon={<LockOutlined />} color="gold">
                      {t('content.pages.protected')}
                    </Tag>
                  </Tooltip>
                ) : null}
                <br />
                <Typography.Text type="secondary" code>
                  /{p.slug}
                </Typography.Text>
                <div>
                  <MissingTranslationsTag items={p.missingTranslations} />
                </div>
              </div>
            ),
          },
          {
            title: t('catalog.fields.status'),
            dataIndex: 'isPublished',
            render: (published: boolean) => (
              <Tag color={published ? 'success' : 'default'}>{published ? t('content.pages.published') : t('content.pages.draft')}</Tag>
            ),
          },
          { title: t('catalog.branchMenu.updatedAt'), dataIndex: 'updatedAt', render: (value: string) => formatDateTime(value) },
          {
            title: t('common.actions'),
            key: 'actions',
            render: (_, p) => (
              <Space size={4}>
                <Button size="small" icon={canEdit ? <EditOutlined /> : <EyeOutlined />} onClick={() => navigate(`/content/pages/${p.id}`)}>
                  {canEdit ? t('common.edit') : t('catalog.view')}
                </Button>
                {canEdit ? (
                  p.isProtected ? (
                    <Tooltip title={t('content.pages.protectedHint')}>
                      <Button size="small" danger icon={<DeleteOutlined />} disabled>
                        {t('common.delete')}
                      </Button>
                    </Tooltip>
                  ) : (
                    <ConfirmAction
                      danger
                      title={t('content.pages.deleteConfirm', { name: translate(p.title, i18n.language) })}
                      description={t('catalog.auditNote')}
                      buttonProps={{ size: 'small', icon: <DeleteOutlined /> }}
                      successMessage={t('catalog.deleted')}
                      onConfirm={async () => {
                        await contentApi.deletePage(p.id);
                        await queryClient.invalidateQueries({ queryKey: queryKeys.pages });
                      }}
                    >
                      {t('common.delete')}
                    </ConfirmAction>
                  )
                ) : null}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
