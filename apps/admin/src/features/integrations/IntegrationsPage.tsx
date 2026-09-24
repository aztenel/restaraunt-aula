import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Col, Empty, Row, Spin, Typography } from 'antd';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationCategory, IntegrationDescriptor } from '@aula/api-client';
import { systemApi } from '@/shared/api/endpoints';
import { queryKeys } from '@/shared/api/query-keys';
import { tx } from '@/shared/i18n/tx';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageHeader } from '@/shared/ui/PageHeader';
import { IntegrationCard } from './IntegrationCard';

const CATEGORY_ORDER: IntegrationCategory[] = ['payments', 'notifications', 'pos', 'delivery', 'accounting', 'esf', 'geocoding', 'analytics', 'other'];

/** Интеграции (право integrations.manage): формы строятся по каталогу адаптеров с сервера. */
export function IntegrationsPage() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const catalog = useQuery({ queryKey: queryKeys.integrationCatalog, queryFn: systemApi.integrationCatalog });
  const settings = useQuery({ queryKey: queryKeys.integrations, queryFn: systemApi.integrations });

  const descriptors = useMemo(() => {
    const list: IntegrationDescriptor[] = [...(catalog.data ?? [])];
    // Настройки без описания в каталоге (адаптер ещё не зарегистрирован) — редактор JSON.
    for (const s of settings.data ?? []) {
      if (!list.some((d) => d.key === s.key)) {
        list.push({ key: s.key, title: s.key, category: 'other', stage: 1, description: '', fields: [] });
      }
    }
    return list;
  }, [catalog.data, settings.data]);

  const groups = CATEGORY_ORDER.map((category) => ({ category, items: descriptors.filter((d) => d.category === category) })).filter(
    (g) => g.items.length > 0,
  );

  return (
    <>
      <PageHeader title={t('nav.integrations')} subtitle={t('sections.integrations')} />
      {catalog.error ? <ErrorAlert error={catalog.error} onRetry={() => void catalog.refetch()} /> : null}
      {settings.error ? <ErrorAlert error={settings.error} onRetry={() => void settings.refetch()} /> : null}
      {catalog.isLoading || settings.isLoading ? <Spin /> : null}
      {!catalog.isLoading && groups.length === 0 ? <Empty description={t('integrations.empty')} /> : null}
      {groups.map((group) => (
        <section key={group.category} style={{ marginBottom: 24 }}>
          <Typography.Title level={4}>{tx(t, `integrations.categories.${group.category}`, group.category)}</Typography.Title>
          <Row gutter={[16, 16]}>
            {group.items.map((descriptor) => (
              <Col key={descriptor.key} xs={24} xl={12}>
                <IntegrationCard
                  descriptor={descriptor}
                  setting={settings.data?.find((s) => s.key === descriptor.key)}
                  onSaved={() => {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.integrations });
                    void message.success(t('common.saved'));
                  }}
                />
              </Col>
            ))}
          </Row>
        </section>
      ))}
    </>
  );
}
