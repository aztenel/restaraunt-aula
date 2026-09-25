/**
 * Каналы уведомлений: настроен ли канал и какие провайдеры (вне продакшена ненастроенный канал пишет
 * в журнал приложения); тестовая отправка в канал для проверки интеграции.
 */
import { SendOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Col, Form, Input, Row, Select, Space, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { notificationKeys, notificationsApi, TEMPLATE_LOCALES, type TemplateKey, type TemplateLocale } from './api';
import { channelHint, NOTIFICATION_CHANNELS, type NotificationChannel } from './template-vars';
import { templateTitle } from './TemplatesTab';

interface TestFormValues {
  channel: NotificationChannel;
  to: string;
  template?: TemplateKey;
  locale: TemplateLocale;
}

export function ChannelsTab() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const notifyError = useNotifyError();
  const channels = useApiQuery(notificationKeys.channels, notificationsApi.channels);
  const templates = useApiQuery(notificationKeys.templates, notificationsApi.templates, { staleTime: 5 * 60_000 });
  const [form] = Form.useForm<TestFormValues>();
  const [sending, setSending] = useState(false);
  const [lastDelivery, setLastDelivery] = useState<string | null>(null);
  const to = (Form.useWatch('to', form) as string | undefined) ?? '';
  const hint = channelHint(to);

  const send = async () => {
    let values: TestFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSending(true);
    try {
      const queued = await notificationsApi.testSend({ channel: values.channel, to: values.to.trim(), template: values.template, locale: values.locale });
      setLastDelivery(queued.deliveryId);
      void message.success(t('notifications.channelsTab.sent'));
    } catch (error) {
      notifyError(error);
    } finally {
      setSending(false);
    }
  };

  if (channels.error) return <ErrorAlert error={channels.error} onRetry={() => void channels.refetch()} />;
  if (!channels.data) return <PageLoader />;

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}>
        <Card title={t('notifications.channelsTab.title')}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {channels.data.map((c) => (
              <Card key={c.channel} size="small">
                <Space wrap>
                  <Typography.Text strong>{t(`notifications.channels.${c.channel as NotificationChannel}`)}</Typography.Text>
                  {c.configured ? <Tag color="success">{t('notifications.channelsTab.configured')}</Tag> : <Tag color="warning">{t('notifications.channelsTab.notConfigured')}</Tag>}
                  {c.providers.map((p) => (
                    <Tag key={p}>{p}</Tag>
                  ))}
                </Space>
                {!c.configured && c.logFallback ? (
                  <Typography.Paragraph type="secondary" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    {t('notifications.channelsTab.logFallback')}
                  </Typography.Paragraph>
                ) : null}
              </Card>
            ))}
            <Typography.Text type="secondary">
              {t('notifications.channelsTab.settingsHint')} <Link to="/integrations">{t('nav.integrations')}</Link>
            </Typography.Text>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={12}>
        <Card title={t('notifications.channelsTab.testTitle')}>
          <Typography.Paragraph type="secondary">{t('notifications.channelsTab.testHint')}</Typography.Paragraph>
          <Form<TestFormValues> form={form} layout="vertical" initialValues={{ channel: 'whatsapp', locale: i18n.language === 'kk' ? 'kk' : 'ru' }}>
            <Form.Item name="channel" label={t('notifications.deliveries.channel')}>
              <Select options={NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: t(`notifications.channels.${c}`) }))} />
            </Form.Item>
            <Form.Item
              name="to"
              label={t('notifications.channelsTab.to')}
              extra={hint ? t('notifications.channelsTab.looksLike', { channel: t(`notifications.channels.${hint}`) }) : t('notifications.channelsTab.toHint')}
              rules={[{ required: true, whitespace: true, message: t('common.required') }]}
            >
              <Input maxLength={120} autoComplete="off" />
            </Form.Item>
            <Row gutter={12}>
              <Col span={16}>
                <Form.Item name="template" label={t('notifications.templates.template')} extra={t('notifications.channelsTab.templateHint')}>
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={(templates.data ?? []).map((tpl) => ({ value: tpl.key, label: templateTitle(tpl, i18n.language) }))}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="locale" label={t('notifications.channelsTab.locale')}>
                  <Select options={TEMPLATE_LOCALES.map((l) => ({ value: l, label: t(`notifications.locales.${l}`) }))} />
                </Form.Item>
              </Col>
            </Row>
            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send()}>
              {t('notifications.channelsTab.send')}
            </Button>
          </Form>
          {lastDelivery ? (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 12 }}
              message={t('notifications.channelsTab.queued')}
              action={<Link to={`/notifications/deliveries?delivery=${lastDelivery}`}>{t('notifications.channelsTab.openDelivery')}</Link>}
            />
          ) : null}
        </Card>
      </Col>
    </Row>
  );
}
