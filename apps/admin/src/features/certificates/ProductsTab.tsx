import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Empty, Flex, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { MoneyText } from '@/shared/ui/MoneyText';
import { useCertificateAbilities } from './abilities';
import { certificateKeys, certificatesApi } from './api';
import { productWithActive } from './product-form';
import { ProductDrawer } from './ProductDrawer';
import type { CertificateProduct } from './types';

/** Продукты сертификатов: на сумму и на набор, цена, срок, оформление (правка — certificates.manage). */
export function ProductsTab() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const abilities = useCertificateAbilities();
  const products = useApiQuery(certificateKeys.products, certificatesApi.products);
  const [editing, setEditing] = useState<CertificateProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: certificateKeys.products });

  return (
    <>
      {abilities.manage ? (
        <Flex justify="flex-end" style={{ marginBottom: 16 }}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            {t('certificates.products.create')}
          </Button>
        </Flex>
      ) : null}
      {products.error ? <ErrorAlert error={products.error} onRetry={() => void products.refetch()} /> : null}
      <Table<CertificateProduct>
        rowKey="id"
        loading={products.isLoading}
        dataSource={products.data ?? []}
        pagination={false}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('certificates.products.empty')} /> }}
        columns={[
          {
            title: t('certificates.products.columns.name'),
            key: 'name',
            render: (_, p) => (
              <div style={{ maxWidth: 320 }}>
                <Space size={4} wrap>
                  <Typography.Text strong>{translate(p.name, i18n.language)}</Typography.Text>
                  {p.missingLocales.length > 0 ? <MissingTranslationsTag items={[{ field: 'name', missing: p.missingLocales }]} /> : null}
                </Space>
                <Typography.Text type="secondary" code style={{ display: 'block', fontSize: 12, width: 'fit-content' }}>
                  {p.slug}
                </Typography.Text>
                {p.kind === 'set' && translate(p.description, i18n.language) ? (
                  <Typography.Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }} ellipsis={{ rows: 2 }}>
                    {translate(p.description, i18n.language)}
                  </Typography.Paragraph>
                ) : null}
              </div>
            ),
          },
          {
            title: t('certificates.products.columns.kind'),
            key: 'kind',
            render: (_, p) => <Tag color={p.kind === 'set' ? 'purple' : 'blue'}>{t(`certificates.kind.${p.kind}`)}</Tag>,
          },
          { title: t('certificates.products.columns.nominal'), key: 'nominal', align: 'right', render: (_, p) => <MoneyText value={p.nominal} /> },
          { title: t('certificates.products.columns.price'), key: 'price', align: 'right', render: (_, p) => <MoneyText value={p.price} strong /> },
          {
            title: t('certificates.products.columns.validity'),
            key: 'validity',
            render: (_, p) => t('certificates.products.validityMonths', { count: p.validityMonths }),
          },
          {
            title: t('certificates.products.columns.design'),
            key: 'design',
            render: (_, p) => (
              <Space size={6}>
                <span
                  aria-hidden
                  style={{ display: 'inline-block', width: 18, height: 18, borderRadius: 4, background: p.design.color, border: '1px solid #e5d9cb' }}
                />
                <Typography.Text type="secondary">{p.design.theme}</Typography.Text>
              </Space>
            ),
          },
          {
            title: t('certificates.products.columns.status'),
            key: 'status',
            render: (_, p) => <Tag color={p.isActive ? 'success' : 'default'}>{p.isActive ? t('certificates.products.onSale') : t('certificates.products.offSale')}</Tag>,
          },
          ...(abilities.manage
            ? [
                {
                  title: t('common.actions'),
                  key: 'actions',
                  render: (_: unknown, p: CertificateProduct) => (
                    <Space size={4} wrap>
                      <Tooltip title={t('common.edit')}>
                        <Button size="small" icon={<EditOutlined />} aria-label={t('common.edit')} onClick={() => setEditing(p)} />
                      </Tooltip>
                      <ConfirmAction
                        title={p.isActive ? t('certificates.products.deactivate') : t('certificates.products.activate')}
                        description={translate(p.name, i18n.language)}
                        buttonProps={{ size: 'small' }}
                        successMessage={p.isActive ? t('certificates.products.deactivated') : t('certificates.products.activated')}
                        onConfirm={async () => {
                          await certificatesApi.updateProduct(p.id, productWithActive(p, !p.isActive));
                          await refresh();
                        }}
                      >
                        {p.isActive ? t('certificates.products.deactivate') : t('certificates.products.activate')}
                      </ConfirmAction>
                      <ConfirmAction
                        danger
                        title={t('certificates.products.deleteConfirm', { name: translate(p.name, i18n.language) })}
                        description={t('certificates.products.deleteHint')}
                        buttonProps={{ size: 'small' }}
                        successMessage={t('certificates.products.deleted')}
                        onConfirm={async () => {
                          await certificatesApi.deleteProduct(p.id);
                          await refresh();
                        }}
                      >
                        {t('common.delete')}
                      </ConfirmAction>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <ProductDrawer
        key={editing?.id ?? (creating ? 'new' : 'closed')}
        open={creating || editing !== null}
        product={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </>
  );
}
