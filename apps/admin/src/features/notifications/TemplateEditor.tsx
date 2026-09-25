/**
 * Редактор текста шаблона уведомления: канал и язык, тема (email), текст с переменными {{param}}
 * (вставка кликом, подсветка неизвестных), проверка до сохранения и ошибки сервера у полей,
 * предпросмотр с примером параметров, возврат стартового текста.
 */
import { EyeOutlined, UndoOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Col, Descriptions, Drawer, Empty, Form, Input, Row, Segmented, Space, Tag, Tooltip, Typography, type GetRef } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { PageLoader } from '@/shared/ui/PageLoader';
import { notificationKeys, notificationsApi, TEMPLATE_LOCALES, type NotificationTemplate, type TemplateKey, type TemplateLocale, type TemplatePreview } from './api';
import { BODY_LIMITS, insertVariable, issueFromApiError, segmentTemplate, validateTemplateText, type NotificationChannel, type TemplateIssue } from './template-vars';
import { templateTitle } from './TemplatesTab';

export function TemplateEditor({ templateKey, onClose }: { templateKey: TemplateKey | null; onClose: () => void }) {
  const { i18n } = useTranslation();
  const query = useApiQuery(notificationKeys.template(templateKey ?? ''), () => notificationsApi.template(templateKey!), { enabled: Boolean(templateKey) });
  const template = query.data?.key === templateKey ? query.data : undefined;
  return (
    <Drawer open={Boolean(templateKey)} onClose={onClose} width={960} destroyOnHidden title={template ? templateTitle(template, i18n.language) : templateKey}>
      {query.error ? <ErrorAlert error={query.error} onRetry={() => void query.refetch()} /> : null}
      {!template && query.isLoading ? <PageLoader /> : null}
      {template ? <EditorBody template={template} /> : null}
    </Drawer>
  );
}

const SEGMENT_STYLE = {
  known: { background: '#e6f4ea', color: '#1d4d31', borderRadius: 3 },
  unknown: { background: '#fbe9e7', color: '#8a2a15', borderRadius: 3, textDecoration: 'underline wavy #b5452c' },
} as const;

function EditorBody({ template }: { template: NotificationTemplate }) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const channels = template.channels as NotificationChannel[];
  const [channel, setChannel] = useState<NotificationChannel>(channels[0] ?? 'whatsapp');
  const [locale, setLocale] = useState<TemplateLocale>(i18n.language === 'kk' ? 'kk' : 'ru');
  const stored = template.texts.find((x) => x.channel === channel && x.locale === locale);
  const [subject, setSubject] = useState(stored?.subject ?? '');
  const [body, setBody] = useState(stored?.body ?? '');
  const [serverIssue, setServerIssue] = useState<TemplateIssue | null>(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [previewing, setPreviewing] = useState(false);
  const bodyRef = useRef<GetRef<typeof Input.TextArea>>(null);
  const cursor = useRef<number | null>(null);

  // Смена канала / языка или обновление шаблона — текст из сохранённого.
  useEffect(() => {
    setSubject(stored?.subject ?? '');
    setBody(stored?.body ?? '');
    setServerIssue(null);
    setPreview(null);
    setPreviewError(null);
  }, [channel, locale, stored?.body, stored?.subject]);

  const issues = useMemo(
    () => validateTemplateText({ channel, subject: channel === 'email' ? subject : null, body, allowed: template.params }),
    [channel, subject, body, template.params],
  );
  const dirty = body !== (stored?.body ?? '') || (channel === 'email' && subject !== (stored?.subject ?? ''));
  const issueText = (issue: TemplateIssue) =>
    issue.code === 'unknown_variables'
      ? t('notifications.editor.issues.unknown_variables', { variables: (issue.variables ?? []).join(', '), allowed: template.params.join(', ') || '—' })
      : issue.code === 'too_long'
        ? t('notifications.editor.issues.too_long', { limit: issue.limit ?? BODY_LIMITS[channel] })
        : t(`notifications.editor.issues.${issue.code}`);
  const fieldIssues = (field: 'body' | 'subject') => [...issues.filter((i) => i.field === field), ...(serverIssue?.field === field ? [serverIssue] : [])];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: notificationKeys.templates });
  };

  const save = async () => {
    if (issues.length > 0) return;
    setSaving(true);
    setServerIssue(null);
    try {
      await notificationsApi.saveText(template.key, channel, locale, { subject: channel === 'email' ? subject : null, body });
      void message.success(t('common.saved'));
      await refresh();
    } catch (error) {
      const issue = issueFromApiError(error);
      if (issue) setServerIssue(issue);
      else notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async (draft: boolean) => {
    setPreviewing(true);
    setPreviewError(null);
    try {
      setPreview(
        await notificationsApi.preview(template.key, {
          channel,
          locale,
          ...(draft ? { body, subject: channel === 'email' ? subject : null } : {}),
        }),
      );
    } catch (error) {
      setPreviewError(error);
    } finally {
      setPreviewing(false);
    }
  };

  const insert = (name: string) => {
    const result = insertVariable(body, cursor.current, name);
    setBody(result.text);
    cursor.current = result.cursor;
    requestAnimationFrame(() => {
      const el = bodyRef.current?.resizableTextArea?.textArea;
      if (el) {
        el.focus();
        el.setSelectionRange(result.cursor, result.cursor);
      }
    });
  };

  const bodyIssues = fieldIssues('body');
  const subjectIssues = fieldIssues('subject');

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <Segmented<NotificationChannel> value={channel} onChange={setChannel} options={channels.map((c) => ({ value: c, label: t(`notifications.channels.${c}`) }))} />
        <Segmented<TemplateLocale> value={locale} onChange={setLocale} options={TEMPLATE_LOCALES.map((l) => ({ value: l, label: t(`notifications.locales.${l}`) }))} />
        {stored?.customized ? <Tag color="gold">{t('notifications.templates.states.customized')}</Tag> : <Tag color="green">{t('notifications.templates.states.default')}</Tag>}
        {stored?.updatedAt ? <Typography.Text type="secondary">{t('notifications.editor.updatedAt', { date: formatDateTime(stored.updatedAt) })}</Typography.Text> : null}
      </Space>
      <Row gutter={24}>
        <Col xs={24} lg={14}>
          <Typography.Text strong>{t('notifications.editor.variables')}</Typography.Text>
          <div style={{ margin: '6px 0 12px' }}>
            {template.params.length === 0 ? (
              <Typography.Text type="secondary">{t('notifications.editor.noVariables')}</Typography.Text>
            ) : (
              <Space size={[4, 4]} wrap>
                {template.params.map((param) => (
                  <Tooltip
                    key={param}
                    title={[
                      template.sample[param] ? t('notifications.editor.sample', { value: template.sample[param] }) : null,
                      template.sensitiveParams.includes(param) ? t('notifications.editor.sensitive') : null,
                      template.optionalParams.includes(param) ? t('notifications.editor.optional') : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  >
                    <Tag
                      color={template.sensitiveParams.includes(param) ? 'magenta' : 'blue'}
                      style={{ cursor: 'pointer', fontFamily: 'monospace' }}
                      onClick={() => insert(param)}
                    >
                      {`{{${param}}}`}
                      {template.optionalParams.includes(param) ? '?' : ''}
                    </Tag>
                  </Tooltip>
                ))}
              </Space>
            )}
          </div>
          <Form layout="vertical">
            {channel === 'email' ? (
              <Form.Item
                label={t('notifications.editor.subject')}
                validateStatus={subjectIssues.length > 0 ? 'error' : undefined}
                help={subjectIssues.length > 0 ? subjectIssues.map(issueText).join('; ') : undefined}
              >
                <Input value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
              </Form.Item>
            ) : null}
            <Form.Item
              label={t('notifications.editor.body')}
              validateStatus={bodyIssues.length > 0 ? 'error' : undefined}
              help={bodyIssues.length > 0 ? bodyIssues.map(issueText).join('; ') : undefined}
              extra={t('notifications.editor.length', { length: body.length, limit: BODY_LIMITS[channel] })}
            >
              <Input.TextArea
                ref={bodyRef}
                value={body}
                autoSize={{ minRows: 6, maxRows: 18 }}
                onChange={(e) => {
                  setBody(e.target.value);
                  cursor.current = e.target.selectionStart;
                  if (serverIssue) setServerIssue(null);
                }}
                onSelect={(e) => {
                  cursor.current = (e.target as HTMLTextAreaElement).selectionStart;
                }}
                style={{ fontFamily: 'monospace' }}
              />
            </Form.Item>
          </Form>
          <div
            aria-label={t('notifications.editor.highlight')}
            style={{ whiteSpace: 'pre-wrap', background: '#fbf8f3', border: '1px solid #ede0d0', borderRadius: 8, padding: 12, fontSize: 13, marginBottom: 12 }}
          >
            {segmentTemplate(body, template.params).map((segment, index) =>
              segment.kind === 'text' ? (
                <span key={index}>{segment.text}</span>
              ) : (
                <span key={index} style={SEGMENT_STYLE[segment.kind]}>
                  {segment.text}
                </span>
              ),
            )}
          </div>
          <Space wrap>
            <Button type="primary" loading={saving} disabled={!dirty || issues.length > 0} onClick={() => void save()}>
              {t('common.save')}
            </Button>
            <Button icon={<EyeOutlined />} loading={previewing} onClick={() => void runPreview(true)}>
              {t('notifications.editor.preview')}
            </Button>
            {stored?.customized || stored?.stored ? (
              <ConfirmAction
                title={t('notifications.editor.resetConfirm')}
                okText={t('notifications.editor.reset')}
                buttonProps={{ icon: <UndoOutlined /> }}
                successMessage={t('notifications.editor.resetDone')}
                onConfirm={async () => {
                  await notificationsApi.resetText(template.key, channel, locale);
                  await refresh();
                }}
              >
                {t('notifications.editor.reset')}
              </ConfirmAction>
            ) : null}
            {dirty ? <Typography.Text type="warning">{t('notifications.editor.unsaved')}</Typography.Text> : null}
          </Space>
        </Col>
        <Col xs={24} lg={10}>
          <Typography.Title level={5} style={{ marginTop: 0 }}>
            {t('notifications.editor.previewTitle')}
          </Typography.Title>
          {previewError ? <Alert type="error" showIcon message={errorMessage(toApiError(previewError), i18n.language)} style={{ marginBottom: 12 }} /> : null}
          {preview ? (
            <PreviewPanel preview={preview} />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('notifications.editor.previewHint')} />
          )}
        </Col>
      </Row>
    </>
  );
}

function PreviewPanel({ preview }: { preview: TemplatePreview }) {
  const { t } = useTranslation();
  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {preview.unknownVariables.length > 0 ? (
        <Alert type="warning" showIcon message={t('notifications.editor.previewUnknown', { variables: preview.unknownVariables.join(', ') })} />
      ) : null}
      <Descriptions size="small" column={1} bordered>
        {preview.subject ? <Descriptions.Item label={t('notifications.editor.subject')}>{preview.subject}</Descriptions.Item> : null}
        <Descriptions.Item label={t('notifications.editor.previewLength')}>
          {preview.sms ? t('notifications.editor.sms', { segments: preview.sms.segments, encoding: preview.sms.encoding.toUpperCase(), length: preview.sms.length }) : preview.length}
        </Descriptions.Item>
      </Descriptions>
      {preview.html ? (
        <iframe title={t('notifications.editor.previewTitle')} sandbox="" srcDoc={preview.html} className="aula-page-preview" style={{ minHeight: 360 }} />
      ) : (
        <div style={{ whiteSpace: 'pre-wrap', background: '#fff', border: '1px solid #ede0d0', borderRadius: 12, padding: 12, fontSize: 14 }}>{preview.text}</div>
      )}
    </Space>
  );
}
