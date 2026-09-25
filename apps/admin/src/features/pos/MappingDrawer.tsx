/**
 * Сопоставление блюда витрины с товаром POS: блюдо (меню филиала), товар (поиск по номенклатуре POS),
 * название товара, сопоставления опций модификаторов. Блюдо у существующего сопоставления не меняется
 * (удалите и создайте заново). Ошибки сервера — по кодам pos.*.
 */
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import { App, Button, Drawer, Form, Input, Select, Space, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate } from '@aula/api-client';
import { useApiQuery } from '@/shared/api/hooks';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { posApi, posKeys, type ProductMapping } from './api';

export interface MappingPrefill {
  dishId?: string;
  externalProductId?: string;
  externalName?: string | null;
}

interface MappingFormValues {
  dishId: string | null;
  externalProductId: string | null;
  externalName: string;
  modifiers: Array<{ optionId: string | null; externalProductId: string; externalGroupId: string }>;
}

type Locale = 'kk' | 'ru' | 'en';

export function MappingDrawer({
  open,
  branchId,
  branchSlug,
  mapping,
  prefill,
  onClose,
}: {
  open: boolean;
  branchId: string;
  branchSlug: string | null;
  /** null — новое сопоставление. */
  mapping: ProductMapping | null;
  prefill?: MappingPrefill;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const [form] = Form.useForm<MappingFormValues>();
  const [saving, setSaving] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const locale: Locale = i18n.language === 'kk' ? 'kk' : 'ru';
  const dishId = Form.useWatch('dishId', form) as string | null | undefined;

  const menu = useApiQuery(posKeys.menu(branchSlug ?? '', locale), () => posApi.publicMenu(branchSlug!, locale), {
    enabled: open && Boolean(branchSlug),
    staleTime: 5 * 60_000,
  });
  const dish = menu.data?.find((d) => d.id === dishId);
  const options = useApiQuery(posKeys.dishOptions(branchSlug ?? '', dish?.slug ?? '', locale), () => posApi.publicDishOptions(branchSlug!, dish!.slug, locale), {
    enabled: open && Boolean(branchSlug && dish),
    staleTime: 5 * 60_000,
  });
  const productsQuery = { branchId, q: productSearch.trim() || undefined, page: 1, perPage: 20 };
  const products = useApiQuery(posKeys.products(productsQuery), () => posApi.products(productsQuery), { enabled: open, keepPrevious: true });

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setProductSearch('');
    form.setFieldsValue(
      mapping
        ? {
            dishId: mapping.dishId,
            externalProductId: mapping.externalProductId,
            externalName: mapping.externalName ?? '',
            modifiers: mapping.modifiers.map((m) => ({ optionId: m.optionId, externalProductId: m.externalProductId, externalGroupId: m.externalGroupId ?? '' })),
          }
        : {
            dishId: prefill?.dishId ?? null,
            externalProductId: prefill?.externalProductId ?? null,
            externalName: prefill?.externalName ?? '',
            modifiers: [],
          },
    );
  }, [open, mapping, prefill, form]);

  const dishOptions = useMemo(() => {
    const list = (menu.data ?? []).map((d) => ({ value: d.id, label: `${d.name} · ${d.categoryName}` }));
    if (mapping && !list.some((o) => o.value === mapping.dishId)) {
      list.unshift({ value: mapping.dishId, label: translate(mapping.dishName, i18n.language) || mapping.dishId });
    }
    return list;
  }, [menu.data, mapping, i18n.language]);

  const productOptions = useMemo(() => {
    const list = (products.data?.items ?? []).map((p) => ({
      value: p.externalProductId,
      label: `${p.name}${p.sku ? ` [${p.sku}]` : ''} · ${p.externalProductId}`,
      name: p.name,
    }));
    const current = form.getFieldValue('externalProductId') as string | null;
    if (current && !list.some((o) => o.value === current)) list.unshift({ value: current, label: current, name: '' });
    return list;
  }, [products.data, form]);

  const save = async () => {
    let values: MappingFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const modifiers = (values.modifiers ?? [])
      .filter((m) => m.optionId && m.externalProductId.trim())
      .map((m) => ({ optionId: m.optionId!, externalProductId: m.externalProductId.trim(), externalGroupId: m.externalGroupId.trim() || null }));
    const body = {
      externalProductId: values.externalProductId!,
      externalName: values.externalName.trim() || null,
      modifiers,
    };
    setSaving(true);
    try {
      if (mapping) await posApi.updateMapping(mapping.id, body);
      else await posApi.createMapping({ ...body, branchId, dishId: values.dishId! });
      void message.success(t('common.saved'));
      void queryClient.invalidateQueries({ queryKey: posKeys.all });
      onClose();
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={640}
      destroyOnHidden
      title={mapping ? t('pos.mappings.editTitle') : t('pos.mappings.createTitle')}
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </Space>
      }
    >
      {!branchSlug ? <Typography.Paragraph type="warning">{t('pos.mappings.menuUnavailable')}</Typography.Paragraph> : null}
      <Form<MappingFormValues> form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="dishId" label={t('pos.fields.dish')} rules={[{ required: true, message: t('common.required') }]} extra={mapping ? t('pos.mappings.dishLocked') : undefined}>
          <Select showSearch optionFilterProp="label" loading={menu.isLoading} disabled={Boolean(mapping)} options={dishOptions} placeholder={t('pos.mappings.dishPlaceholder')} />
        </Form.Item>
        <Form.Item name="externalProductId" label={t('pos.fields.product')} rules={[{ required: true, message: t('common.required') }]}>
          <Select
            showSearch
            filterOption={false}
            onSearch={setProductSearch}
            loading={products.isFetching}
            options={productOptions}
            placeholder={t('pos.mappings.productPlaceholder')}
            onChange={(value: string) => {
              const option = productOptions.find((o) => o.value === value);
              if (option?.name && !form.getFieldValue('externalName')) form.setFieldValue('externalName', option.name);
            }}
            notFoundContent={t('pos.mappings.productNotFound')}
          />
        </Form.Item>
        <Form.Item name="externalName" label={t('pos.fields.externalName')} extra={t('pos.mappings.externalNameHint')}>
          <Input maxLength={200} />
        </Form.Item>
        <Typography.Title level={5}>{t('pos.mappings.modifiers')}</Typography.Title>
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          {t('pos.mappings.modifiersHint')}
        </Typography.Paragraph>
        <Form.List name="modifiers">
          {(fields, { add, remove }) => (
            <>
              {fields.map((field) => (
                <Space key={field.key} align="start" wrap style={{ display: 'flex', marginBottom: 8 }}>
                  <Form.Item name={[field.name, 'optionId']} rules={[{ required: true, message: t('common.required') }]} style={{ marginBottom: 0, width: 220 }}>
                    <Select
                      showSearch
                      optionFilterProp="label"
                      placeholder={t('pos.mappings.option')}
                      loading={options.isLoading}
                      options={(options.data ?? []).map((o) => ({ value: o.id, label: `${o.groupName}: ${o.name}` }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'externalProductId']} rules={[{ required: true, whitespace: true, message: t('common.required') }]} style={{ marginBottom: 0 }}>
                    <Input placeholder={t('pos.mappings.modifierProduct')} maxLength={100} style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item name={[field.name, 'externalGroupId']} style={{ marginBottom: 0 }}>
                    <Input placeholder={t('pos.mappings.modifierGroup')} maxLength={100} style={{ width: 140 }} />
                  </Form.Item>
                  <Button icon={<DeleteOutlined />} aria-label={t('common.delete')} onClick={() => remove(field.name)} />
                </Space>
              ))}
              <Button icon={<PlusOutlined />} onClick={() => add({ optionId: null, externalProductId: '', externalGroupId: '' })} disabled={!dishId}>
                {t('pos.mappings.addModifier')}
              </Button>
            </>
          )}
        </Form.List>
      </Form>
    </Drawer>
  );
}
