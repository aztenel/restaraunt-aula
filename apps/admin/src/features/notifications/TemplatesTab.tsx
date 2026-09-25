/**
 * Шаблоны уведомлений: ключ × канал × язык. Изменённые тексты отмечены; редактор — переменные шаблона
 * (из API), подсветка неизвестных переменных, предпросмотр с примером параметров (SMS — число частей),
 * ошибки проверки у полей, возврат стартового текста.
 */
import { EditOutlined } from '@ant-design/icons';
import { Card, Input, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '@/shared/api/hooks';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { notificationKeys, notificationsApi, TEMPLATE_LOCALES, type NotificationTemplate, type TemplateKey } from './api';
import { TemplateEditor } from './TemplateEditor';

export function templateTitle(template: Pick<NotificationTemplate, 'title' | 'key'>, language: string): string {
  return (language === 'kk' ? template.title.kk : template.title.ru) || template.key;
}

export function TemplatesTab() {
  const { t, i18n } = useTranslation();
  const [audience, setAudience] = useState<'all' | 'guest' | 'staff'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TemplateKey | null>(null);
  const templates = useApiQuery(notificationKeys.templates, notificationsApi.templates);
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates.data ?? []).filter(
      (tpl) =>
        (audience === 'all' || tpl.audience === audience) &&
        (!q || tpl.key.includes(q) || templateTitle(tpl, i18n.language).toLowerCase().includes(q)),
    );
  }, [templates.data, audience, search, i18n.language]);

  return (
    <Card>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented
          value={audience}
          onChange={(value) => setAudience(value as typeof audience)}
          options={[
            { value: 'all', label: t('notifications.templates.all') },
            { value: 'guest', label: t('notifications.audiences.guest') },
            { value: 'staff', label: t('notifications.audiences.staff') },
          ]}
        />
        <Input.Search allowClear placeholder={t('notifications.templates.search')} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
      </Space>
      {templates.error ? <ErrorAlert error={templates.error} onRetry={() => void templates.refetch()} /> : null}
      <Table<NotificationTemplate>
        rowKey="key"
        size="small"
        loading={templates.isLoading}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 'max-content' }}
        onRow={(tpl) => ({ onDoubleClick: () => setEditing(tpl.key) })}
        columns={[
          {
            title: t('notifications.templates.template'),
            key: 'title',
            render: (_, tpl) => (
              <Space direction="vertical" size={0}>
                <Typography.Link onClick={() => setEditing(tpl.key)}>{templateTitle(tpl, i18n.language)}</Typography.Link>
                <Typography.Text type="secondary" code style={{ fontSize: 12 }}>
                  {tpl.key}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: t('notifications.templates.audience'),
            key: 'audience',
            render: (_, tpl) => <Tag color={tpl.audience === 'guest' ? 'blue' : 'purple'}>{t(`notifications.audiences.${tpl.audience as 'guest'}`)}</Tag>,
          },
          {
            title: t('notifications.templates.texts'),
            key: 'texts',
            render: (_, tpl) => (
              <Space direction="vertical" size={2}>
                {tpl.channels.map((channel) => (
                  <Space key={channel} size={4} wrap>
                    <Typography.Text style={{ width: 80, display: 'inline-block' }}>{t(`notifications.channels.${channel}`)}</Typography.Text>
                    {TEMPLATE_LOCALES.map((locale) => {
                      const text = tpl.texts.find((x) => x.channel === channel && x.locale === locale);
                      const state = !text ? 'missing' : text.customized ? 'customized' : 'default';
                      return (
                        <Tooltip key={locale} title={t(`notifications.templates.states.${state}`)}>
                          <Tag color={state === 'customized' ? 'gold' : state === 'missing' ? 'default' : 'green'} style={{ marginInlineEnd: 0 }}>
                            {locale}
                          </Tag>
                        </Tooltip>
                      );
                    })}
                  </Space>
                ))}
              </Space>
            ),
          },
          {
            title: t('notifications.templates.params'),
            key: 'params',
            render: (_, tpl) => (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {tpl.params.join(', ') || '—'}
              </Typography.Text>
            ),
          },
          {
            key: 'edit',
            render: (_, tpl) => (
              <Typography.Link onClick={() => setEditing(tpl.key)}>
                <EditOutlined /> {t('common.edit')}
              </Typography.Link>
            ),
          },
        ]}
      />
      <TemplateEditor templateKey={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}
