import { useQuery } from '@tanstack/react-query';
import { Card, Checkbox, Col, Empty, Flex, Progress, Row, Select, Space, Table, Tag, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { LOCALES, type Locale, type TranslationEntityType, type TranslationGap } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useAuth } from '@/shared/auth/AuthProvider';
import { tx } from '@/shared/i18n/tx';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { canViewContent, catalogAbilities } from '../../menu/abilities';
import { needsModifierGroups, translationEditPath } from '../../menu/translation-links';

const ENTITY_TYPES: TranslationEntityType[] = ['category', 'dish', 'modifier_group', 'modifier_option', 'banner', 'promotion', 'page'];
const MENU_ENTITIES: TranslationEntityType[] = ['category', 'dish', 'modifier_group', 'modifier_option'];

/**
 * Полнота переводов (решение №10): какие категории, блюда, модификаторы, баннеры, акции и страницы
 * не переведены на kk/ru (и en по запросу). Считает сервер; здесь — сводка и ссылки на формы.
 */
export function TranslationsTab() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const menuAccess = catalogAbilities(me).viewCatalog;
  const contentAccess = canViewContent(me);
  const [locales, setLocales] = useState<Locale[]>(['kk', 'ru']);
  const [entityType, setEntityType] = useState<TranslationEntityType | undefined>();
  const params = useMemo(() => ({ locales: locales.join(','), entityType }), [locales, entityType]);
  const report = useQuery({ queryKey: queryKeys.translations(params), queryFn: () => catalogApi.translations(params), enabled: locales.length > 0 });
  // Опции модификаторов: ссылка ведёт на группу (отчёт отдаёт id опции).
  // Группа опции модификатора приходит в отчёте (groupId); список групп — только для ответов без неё.
  const groups = useQuery({
    queryKey: queryKeys.modifierGroups,
    queryFn: catalogApi.modifierGroups,
    enabled: menuAccess && needsModifierGroups(report.data?.items ?? []),
    staleTime: 60_000,
  });

  const canOpen = (type: TranslationEntityType) => (MENU_ENTITIES.includes(type) ? menuAccess : contentAccess);
  const entityLabel = (type: string) => tx(t, `content.translations.entities.${type}`, type);

  return (
    <>
      <Flex gap={16} wrap align="center" style={{ marginBottom: 16 }}>
        <Space>
          <Typography.Text>{t('content.translations.locales')}:</Typography.Text>
          <Checkbox.Group<Locale>
            value={locales}
            onChange={(value) => setLocales(value)}
            options={LOCALES.map((l) => ({ value: l, label: t(`translatable.${l}`) }))}
          />
        </Space>
        <Select<TranslationEntityType>
          allowClear
          placeholder={t('content.translations.allEntities')}
          style={{ width: 240 }}
          value={entityType}
          onChange={setEntityType}
          options={ENTITY_TYPES.map((type) => ({ value: type, label: entityLabel(type) }))}
        />
      </Flex>
      {report.error ? <ErrorAlert error={report.error} onRetry={() => void report.refetch()} /> : null}
      {locales.length === 0 ? <Empty description={t('content.translations.pickLocale')} /> : null}
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {(report.data?.summary ?? []).map((s) => (
          <Col key={s.entityType} xs={12} md={8} xl={6} xxl={3}>
            <Card size="small" hoverable onClick={() => setEntityType(s.entityType)} style={{ height: '100%' }}>
              <Typography.Text strong>{entityLabel(s.entityType)}</Typography.Text>
              <Progress
                percent={s.total === 0 ? 100 : Math.floor(((s.total - s.incomplete) / s.total) * 100)}
                size="small"
                status={s.incomplete > 0 ? 'normal' : 'success'}
              />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('content.translations.incomplete', { incomplete: s.incomplete, total: s.total })}
              </Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
      <Table<TranslationGap>
        rowKey={(gap) => `${gap.entityType}:${gap.entityId}:${gap.field}`}
        size="middle"
        loading={report.isLoading}
        dataSource={report.data?.items ?? []}
        pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (total) => t('common.total', { count: total }) }}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('content.translations.complete') }}
        columns={[
          { title: t('content.translations.entity'), dataIndex: 'entityType', render: (type: string) => <Tag>{entityLabel(type)}</Tag> },
          {
            title: t('catalog.fields.name'),
            key: 'label',
            render: (_, gap) => {
              const path = canOpen(gap.entityType) ? translationEditPath(gap, groups.data ?? []) : null;
              const label = gap.label || gap.entityId;
              return path ? <Link to={path}>{label}</Link> : <Typography.Text>{label}</Typography.Text>;
            },
          },
          { title: t('content.translations.field'), dataIndex: 'field', render: (field: string) => tx(t, `catalog.fields.${field}`, field) },
          {
            title: t('content.translations.missing'),
            dataIndex: 'missing',
            render: (missing: Locale[]) => (
              <Space size={4}>
                {missing.map((l) => (
                  <Tag key={l} color="warning">
                    {t(`translatable.${l}`)}
                  </Tag>
                ))}
              </Space>
            ),
          },
        ]}
      />
    </>
  );
}
