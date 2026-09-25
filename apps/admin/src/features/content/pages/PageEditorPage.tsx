import { ArrowLeftOutlined, DeleteOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Col, Flex, Form, Input, InputNumber, Row, Space, Switch, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { translate, type ContentPage, type Locale } from '@aula/api-client';
import { contentApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { PageLoader } from '@/shared/ui/PageLoader';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { SLUG_PATTERN } from '../../menu/slug';
import { useUnsavedChangesGuard } from '../../menu/useUnsavedChangesGuard';
import { formToPageInput, pageToForm, sanitizedLocales, type PageFormValues } from '../forms';
import { useContentAbilities } from '../useContentAbilities';
import { HtmlBodyEditor } from './HtmlBodyEditor';

/**
 * Статическая страница витрины (доставка, оплата, оферта...): переводимые заголовок, HTML и SEO.
 * Юридические страницы (оферта, политика) нельзя удалить, снять с публикации и сменить им адрес —
 * поля заблокированы, а ответ сервера content.page_protected показывается текстом.
 */
export function PageEditorPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { pages: canEdit } = useContentAbilities();
  const [form] = Form.useForm<PageFormValues>();
  const [saving, setSaving] = useState(false);
  const [sanitized, setSanitized] = useState<Locale[]>([]);
  const initializedFor = useRef<string | null>(null);
  const dirty = useUnsavedChangesGuard(canEdit);

  const page = useQuery({ queryKey: queryKeys.page(id), queryFn: () => contentApi.page(id), enabled: !isNew });
  const current: ContentPage | null = isNew ? null : (page.data ?? null);

  useEffect(() => {
    const key = isNew ? 'new' : page.data?.id;
    if (!key || initializedFor.current === key) return;
    initializedFor.current = key;
    form.resetFields();
    form.setFieldsValue(pageToForm(isNew ? null : (page.data ?? null)));
    dirty.current = false;
  }, [isNew, page.data, form, dirty]);

  const submit = async () => {
    let values: PageFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToPageInput(values);
      const saved = isNew ? await contentApi.createPage(input) : await contentApi.updatePage(id, input);
      queryClient.setQueryData(queryKeys.page(saved.id), saved);
      void queryClient.invalidateQueries({ queryKey: queryKeys.pages });
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      setSanitized(sanitizedLocales(input.body, saved.body));
      dirty.current = false;
      initializedFor.current = saved.id;
      // Черновик заменяется очищенной сервером версией — то, что реально увидит гость.
      form.setFieldsValue(pageToForm(saved));
      void message.success(isNew ? t('catalog.createdWithSlug', { slug: saved.slug }) : t('common.saved'));
      if (isNew) navigate(`/content/pages/${saved.id}`, { replace: true });
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && page.isLoading) return <PageLoader />;
  if (!isNew && page.error) return <ErrorAlert error={page.error} onRetry={() => void page.refetch()} />;
  const isProtected = current?.isProtected ?? false;

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/content/pages')}>
            {t('common.back')}
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {current ? translate(current.title, i18n.language) : t('content.pages.createTitle')}
          </Typography.Title>
          {isProtected ? (
            <Tooltip title={t('content.pages.protectedHint')}>
              <Tag icon={<LockOutlined />} color="gold">
                {t('content.pages.protected')}
              </Tag>
            </Tooltip>
          ) : null}
          {current ? <MissingTranslationsTag items={current.missingTranslations} /> : null}
        </Space>
        {canEdit ? (
          <Space wrap>
            {current && !isProtected ? (
              <ConfirmAction
                danger
                title={t('content.pages.deleteConfirm', { name: translate(current.title, i18n.language) })}
                description={t('catalog.auditNote')}
                buttonProps={{ icon: <DeleteOutlined /> }}
                successMessage={t('catalog.deleted')}
                onConfirm={async () => {
                  await contentApi.deletePage(current.id);
                  dirty.current = false;
                  queryClient.removeQueries({ queryKey: queryKeys.page(current.id) });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.pages });
                  navigate('/content/pages', { replace: true });
                }}
              >
                {t('common.delete')}
              </ConfirmAction>
            ) : null}
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void submit()}>
              {t('common.save')}
            </Button>
          </Space>
        ) : null}
      </Flex>
      {!canEdit ? <Typography.Paragraph type="secondary">{t('content.pages.readOnly')}</Typography.Paragraph> : null}
      {sanitized.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          closable
          onClose={() => setSanitized([])}
          style={{ marginBottom: 16 }}
          message={t('content.pages.sanitized', { locales: sanitized.map((l) => t(`translatable.${l}`)).join(', ') })}
        />
      ) : null}
      <Form<PageFormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        disabled={!canEdit}
        onValuesChange={() => {
          dirty.current = true;
        }}
      >
        <Card style={{ marginBottom: 16 }}>
          <Form.Item name="title" label={t('content.fields.title')} rules={[translatableRule(t('translatable.required'))]}>
            <TranslatableInput maxLength={200} />
          </Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}>
              <Form.Item
                name="slug"
                label={t('catalog.fields.slug')}
                extra={isProtected ? t('content.pages.protectedSlug') : current ? t('catalog.slugCurrent', { slug: current.slug }) : t('catalog.slugAuto')}
                rules={[{ pattern: SLUG_PATTERN, message: t('catalog.slugRule') }]}
              >
                <Input maxLength={80} addonBefore="/" disabled={isProtected} placeholder={current ? undefined : t('catalog.slugPlaceholder')} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item name="sortOrder" label={t('catalog.fields.sortOrder')}>
                <InputNumber precision={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} sm={6}>
              <Form.Item
                name="isPublished"
                label={t('content.pages.isPublished')}
                valuePropName="checked"
                extra={isProtected ? t('content.pages.protectedPublished') : undefined}
              >
                <Switch disabled={isProtected} />
              </Form.Item>
            </Col>
          </Row>
        </Card>
        <Card title={t('content.pages.body')} style={{ marginBottom: 16 }}>
          <Form.Item
            name="body"
            noStyle
            rules={[translatableRule(t('content.pages.bodyRequired'))]}
          >
            <HtmlBodyEditor disabled={!canEdit} />
          </Form.Item>
          <Form.Item shouldUpdate noStyle>
            {() => {
              const errors = form.getFieldError('body');
              return errors.length > 0 ? <Typography.Text type="danger">{errors[0]}</Typography.Text> : null;
            }}
          </Form.Item>
        </Card>
        <Card title={t('catalog.seo')}>
          <Form.Item name="seoTitle" label={t('catalog.fields.seoTitle')}>
            <TranslatableInput maxLength={120} />
          </Form.Item>
          <Form.Item name="seoDescription" label={t('catalog.fields.seoDescription')}>
            <TranslatableInput multiline rows={2} maxLength={320} />
          </Form.Item>
        </Card>
      </Form>
    </>
  );
}
