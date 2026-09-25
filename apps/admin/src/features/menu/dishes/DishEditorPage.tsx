import { ArrowLeftOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Col, Flex, Form, Input, InputNumber, Radio, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { translate, type Dish, type DishBranchPrice } from '@aula/api-client';
import { catalogApi } from '@/shared/api/catalog';
import { queryKeys } from '@/shared/api/query-keys';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { formatDateTime } from '@/shared/lib/dates';
import { ConfirmAction } from '@/shared/ui/ConfirmAction';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MissingTranslationsTag } from '@/shared/ui/MissingTranslationsTag';
import { MoneyText } from '@/shared/ui/MoneyText';
import { PageLoader } from '@/shared/ui/PageLoader';
import { TranslatableInput, translatableRule } from '@/shared/ui/TranslatableInput';
import { dishToForm, formToDishInput, SPICY_LEVELS, type DishFormValues } from '../forms';
import { bySortOrder } from '../reorder';
import { SLUG_PATTERN } from '../slug';
import { useCatalogAbilities } from '../useAbilities';
import { useUnsavedChangesGuard } from '../useUnsavedChangesGuard';
import { DishPhotos } from './DishPhotos';
import { SPICY_KEYS } from './DishesTab';
import { ModifierGroupsField } from './ModifierGroupsField';

/**
 * Карточка блюда (menu.content): переводимые название, описание, состав и SEO; вес, калорийность,
 * острота, вегетарианское/халал, аллергены; категория; группы модификаторов; общий код POS;
 * фото (для сохранённого блюда); цены по филиалам — только просмотр (меняются в меню филиала).
 */
export function DishEditorPage() {
  const { id = 'new' } = useParams();
  const isNew = id === 'new';
  const [search] = useSearchParams();
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { editCatalog } = useCatalogAbilities();
  const [form] = Form.useForm<DishFormValues>();
  const [saving, setSaving] = useState(false);
  const initializedFor = useRef<string | null>(null);

  const dish = useQuery({ queryKey: queryKeys.dish(id), queryFn: () => catalogApi.dish(id), enabled: !isNew });
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: catalogApi.categories, staleTime: 60_000 });
  const groups = useQuery({ queryKey: queryKeys.modifierGroups, queryFn: catalogApi.modifierGroups, staleTime: 60_000 });
  const allergens = useQuery({ queryKey: queryKeys.allergens, queryFn: catalogApi.allergens, staleTime: Infinity });

  const dirty = useUnsavedChangesGuard(editCatalog);

  // Форма заполняется один раз для блюда (обновление фото не сбрасывает несохранённые правки).
  useEffect(() => {
    const key = isNew ? 'new' : dish.data?.id;
    if (!key || initializedFor.current === key) return;
    initializedFor.current = key;
    form.resetFields();
    form.setFieldsValue(dishToForm(isNew ? null : (dish.data ?? null), { categoryId: search.get('categoryId') ?? undefined }));
    dirty.current = false;
  }, [isNew, dish.data, form, search, dirty]);

  const setDish = (next: Dish) => queryClient.setQueryData(queryKeys.dish(next.id), next);

  const submit = async () => {
    let values: DishFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    setSaving(true);
    try {
      const input = formToDishInput(values);
      const saved = isNew ? await catalogApi.createDish(input) : await catalogApi.updateDish(id, input);
      setDish(saved);
      dirty.current = false;
      initializedFor.current = saved.id;
      form.setFieldsValue(dishToForm(saved));
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'translations'] });
      void queryClient.invalidateQueries({ queryKey: ['catalog', 'branch-menu'] });
      if (isNew) {
        void message.success(t('catalog.createdWithSlug', { slug: saved.slug }));
        // Переход к сохранённой карточке (загрузка фото доступна после создания).
        navigate(`/menu/dishes/${saved.id}`, { replace: true });
      } else {
        void message.success(t('common.saved'));
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && dish.isLoading) return <PageLoader />;
  if (!isNew && dish.error) return <ErrorAlert error={dish.error} onRetry={() => void dish.refetch()} />;
  const current = isNew ? null : (dish.data ?? null);
  const title = current ? translate(current.name, i18n.language) : t('catalog.dishes.createTitle');

  return (
    <>
      <Flex justify="space-between" align="center" gap={8} wrap style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/menu/dishes')}>
            {t('common.back')}
          </Button>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {current && !current.isActive ? <Tag>{t('common.inactive')}</Tag> : null}
          {current ? <MissingTranslationsTag items={current.missingTranslations} /> : null}
        </Space>
        {editCatalog ? (
          <Space wrap>
            {current ? (
              <ConfirmAction
                danger
                title={t('catalog.dishes.deleteConfirm', { name: title })}
                description={t('catalog.dishes.deleteDescription')}
                buttonProps={{ icon: <DeleteOutlined /> }}
                successMessage={t('catalog.deleted')}
                onConfirm={async () => {
                  await catalogApi.deleteDish(current.id);
                  dirty.current = false;
                  queryClient.removeQueries({ queryKey: queryKeys.dish(current.id) });
                  void queryClient.invalidateQueries({ queryKey: queryKeys.catalog });
                  navigate('/menu/dishes', { replace: true });
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
      {!editCatalog ? <Typography.Paragraph type="secondary">{t('catalog.readOnly')}</Typography.Paragraph> : null}
      <Form<DishFormValues> form={form} layout="vertical" requiredMark="optional" disabled={!editCatalog} onValuesChange={() => {
          dirty.current = true;
        }}>
        <Row gutter={16}>
          <Col xs={24} xl={14}>
            <Card title={t('catalog.dishes.sections.main')} style={{ marginBottom: 16 }}>
              <Form.Item name="name" label={t('catalog.fields.name')} rules={[translatableRule(t('translatable.required'))]}>
                <TranslatableInput maxLength={200} />
              </Form.Item>
              <Row gutter={12}>
                <Col xs={24} sm={12}>
                  <Form.Item name="categoryId" label={t('catalog.fields.category')} rules={[{ required: true, message: t('common.required') }]}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      loading={categories.isLoading}
                      options={bySortOrder(categories.data ?? []).map((c) => ({
                        value: c.id,
                        label: translate(c.name, i18n.language) + (c.isActive ? '' : ` (${t('common.inactive')})`),
                      }))}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="slug"
                    label={t('catalog.fields.slug')}
                    extra={current ? t('catalog.slugCurrent', { slug: current.slug }) : t('catalog.slugAuto')}
                    rules={[{ pattern: SLUG_PATTERN, message: t('catalog.slugRule') }]}
                  >
                    <Input maxLength={80} placeholder={current ? undefined : t('catalog.slugPlaceholder')} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="sku" label={t('catalog.fields.sku')} extra={t('catalog.dishes.skuHint')} rules={[{ pattern: /^[\p{L}\p{N}._:/-]{0,64}$/u, message: t('catalog.dishes.skuRule') }]}>
                    <Input maxLength={64} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item name="sortOrder" label={t('catalog.fields.sortOrder')}>
                    <InputNumber precision={0} min={-1_000_000} max={1_000_000} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={6}>
                  <Form.Item name="isActive" label={t('catalog.fields.isActive')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="description" label={t('catalog.fields.description')}>
                <TranslatableInput multiline rows={3} maxLength={4000} />
              </Form.Item>
              <Form.Item name="composition" label={t('catalog.fields.composition')}>
                <TranslatableInput multiline rows={2} maxLength={2000} />
              </Form.Item>
            </Card>
            <Card title={t('catalog.dishes.sections.attributes')} style={{ marginBottom: 16 }}>
              <Row gutter={12}>
                <Col xs={12} sm={8}>
                  <Form.Item name="weightGrams" label={t('catalog.fields.weightGrams')}>
                    <InputNumber min={1} max={100_000} precision={0} addonAfter={t('catalog.dishes.gramsUnit')} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={8}>
                  <Form.Item name="calories" label={t('catalog.fields.calories')}>
                    <InputNumber min={0} max={20_000} precision={0} addonAfter={t('catalog.dishes.kcalUnit')} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={4}>
                  <Form.Item name="isVegetarian" label={t('catalog.fields.isVegetarian')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
                <Col xs={12} sm={4}>
                  <Form.Item name="isHalal" label={t('catalog.fields.isHalal')} valuePropName="checked">
                    <Switch />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="spicyLevel" label={t('catalog.fields.spicyLevel')}>
                <Radio.Group
                  optionType="button"
                  buttonStyle="solid"
                  options={SPICY_LEVELS.map((level) => ({ value: level, label: `${level} · ${t(`catalog.dishes.spicy.${SPICY_KEYS[level]}`)}` }))}
                />
              </Form.Item>
              <Form.Item name="allergens" label={t('catalog.fields.allergens')}>
                <Select
                  mode="multiple"
                  allowClear
                  loading={allergens.isLoading}
                  optionFilterProp="label"
                  options={(allergens.data ?? []).map((a) => ({ value: a.code, label: translate(a.name, i18n.language) }))}
                />
              </Form.Item>
            </Card>
          </Col>
          <Col xs={24} xl={10}>
            <Card title={t('catalog.dishes.sections.modifiers')} style={{ marginBottom: 16 }}>
              <Form.Item name="modifierGroupIds" noStyle>
                <ModifierGroupsField groups={groups.data ?? []} loading={groups.isLoading} disabled={!editCatalog} />
              </Form.Item>
            </Card>
            <Card title={t('catalog.dishes.sections.photos')} style={{ marginBottom: 16 }}>
              {current ? (
                <DishPhotos dish={current} canEdit={editCatalog} onChange={setDish} />
              ) : (
                <Typography.Text type="secondary">{t('catalog.images.saveFirst')}</Typography.Text>
              )}
            </Card>
            <Card title={t('catalog.seo')} style={{ marginBottom: 16 }}>
              <Form.Item name="seoTitle" label={t('catalog.fields.seoTitle')} extra={t('catalog.seoTitleHint')}>
                <TranslatableInput maxLength={120} />
              </Form.Item>
              <Form.Item name="seoDescription" label={t('catalog.fields.seoDescription')}>
                <TranslatableInput multiline rows={2} maxLength={320} />
              </Form.Item>
            </Card>
            {current ? <BranchPricesCard prices={current.branchPrices ?? []} /> : null}
          </Col>
        </Row>
      </Form>
    </>
  );
}

/** Цены блюда по доступным филиалам — только просмотр; изменяются в «Меню филиала». */
function BranchPricesCard({ prices }: { prices: DishBranchPrice[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { branchName, setSelection } = useBranch();
  return (
    <Card title={t('catalog.dishes.sections.branchPrices')} style={{ marginBottom: 16 }}>
      <Table<DishBranchPrice>
        size="small"
        rowKey="branchId"
        pagination={false}
        dataSource={prices}
        locale={{ emptyText: t('catalog.dishes.notInAnyMenu') }}
        columns={[
          {
            title: t('layout.branch'),
            dataIndex: 'branchId',
            render: (branchId: string) => (
              <Button
                type="link"
                size="small"
                style={{ padding: 0 }}
                onClick={() => {
                  setSelection(branchId);
                  navigate('/menu/branch');
                }}
              >
                {branchName(branchId)}
              </Button>
            ),
          },
          { title: t('catalog.branchMenu.price'), dataIndex: 'price', render: (price: DishBranchPrice['price']) => <MoneyText value={price} /> },
          {
            title: t('catalog.branchMenu.availability'),
            key: 'availability',
            render: (_, p) =>
              p.availability === 'stopped' ? (
                <Tag color="error">
                  {t('stopList.stopped')}
                  {p.stoppedUntil ? ` · ${t('stopList.until', { time: formatDateTime(p.stoppedUntil) })}` : ''}
                </Tag>
              ) : (
                <Tag color="success">{t('stopList.available')}</Tag>
              ),
          },
        ]}
      />
    </Card>
  );
}
