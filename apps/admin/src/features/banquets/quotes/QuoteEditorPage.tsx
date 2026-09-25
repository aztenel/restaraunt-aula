import { ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  DatePicker,
  Dropdown,
  Empty,
  Flex,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { formatMoney, translate } from '@aula/api-client';
import { useApiMutation, useApiQuery } from '@/shared/api/hooks';
import { dayjs } from '@/shared/lib/dates';
import { ErrorAlert } from '@/shared/ui/ErrorAlert';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { PageHeader } from '@/shared/ui/PageHeader';
import { PageLoader } from '@/shared/ui/PageLoader';
import { StatusTag } from '@/shared/ui/StatusTag';
import { useUnsavedChangesGuard } from '@/features/menu/useUnsavedChangesGuard';
import { useRequestAbilities } from '../abilities';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { MoneyText } from '@/shared/ui/MoneyText';
import { banquetRefKeys, banquetsApi, banquetsKeys } from '../api';
import { useDebounced } from '../common/ui';
import { todayLocal } from '../calendar-layout';
import { useInvalidateBanquets } from '../request/useRequestMutation';
import { bpToPercentText } from '../sla';
import { CUSTOM_LINE_KINDS, type DishOption, type Quote } from '../types';
import { DishSearchSelect } from './DishSearchSelect';
import {
  emptyQuoteForm,
  formToSaveInput,
  isCustomKind,
  lineIssues,
  previewLineTotal,
  moveLine,
  newCustomLine,
  newMenuLine,
  quoteToForm,
  type DiscountFormValue,
  type DiscountMode,
  type QuoteFormIssue,
  type QuoteFormValues,
  type QuoteLineForm,
} from '../quote-form';
import { QuoteTotals } from './QuoteView';

function DiscountField({
  value,
  onChange,
  invalid,
  size,
}: {
  value: DiscountFormValue;
  onChange: (value: DiscountFormValue) => void;
  invalid?: boolean;
  size?: 'small' | 'middle';
}) {
  const { t } = useTranslation();
  return (
    <Space.Compact size={size} style={{ width: 200 }}>
      <Select<DiscountMode>
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        style={{ width: 76 }}
        options={(['none', 'percent', 'amount'] as const).map((mode) => ({ value: mode, label: t(`banquets.quote.editor.discountModes.${mode}`) }))}
        aria-label={t('banquets.quote.editor.discount')}
      />
      {value.mode === 'percent' ? (
        <Input
          value={value.percent}
          onChange={(e) => onChange({ ...value, percent: e.target.value })}
          suffix="%"
          inputMode="decimal"
          status={invalid ? 'error' : undefined}
          style={{ width: 124 }}
        />
      ) : value.mode === 'amount' ? (
        <MoneyInput value={value.amount} onChange={(amount) => onChange({ ...value, amount })} status={invalid ? 'error' : undefined} style={{ width: 124 }} />
      ) : (
        <Input disabled value="" style={{ width: 124 }} />
      )}
    </Space.Compact>
  );
}

/**
 * Конструктор сметы — новая версия (прошлые версии неизменяемы). Позиции меню (снимок цены — на сервере)
 * и произвольные позиции, количество, скидки по строкам и общая, процент за обслуживание.
 * Итоги НЕ считаются в браузере: их рассчитывает сервер при сохранении версии.
 */
export function QuoteEditorPage() {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const invalidate = useInvalidateBanquets();
  const detail = useApiQuery(banquetsKeys.detail(id), () => banquetsApi.get(id));
  const latestSummary = detail.data?.quotes.find((q) => q.isLatest) ?? null;
  const latest = useApiQuery(banquetsKeys.quote(latestSummary?.id ?? ''), () => banquetsApi.quote(latestSummary?.id ?? ''), { enabled: Boolean(latestSummary) });
  const abilities = useRequestAbilities(detail.data?.branchId);
  const [values, setValues] = useState<QuoteFormValues | null>(null);
  const [issues, setIssues] = useState<QuoteFormIssue[]>([]);
  const [base, setBase] = useState<Quote | null>(null);
  const dirty = useUnsavedChangesGuard(true);
  // Предпросмотр итогов сервером: форма без ошибок → (через паузу) POST /quotes/preview; в браузере ничего не считается.
  const previewInput = useMemo(() => {
    if (!values) return null;
    const result = formToSaveInput(values);
    return result.ok ? result.input : null;
  }, [values]);
  const debouncedInput = useDebounced(previewInput, 600);
  const canPreview = Boolean(detail.data?.canEditQuote) && debouncedInput !== null;
  const preview = useApiQuery(banquetRefKeys.quotePreview(id, debouncedInput), () => banquetsApi.previewQuote(id, debouncedInput!), {
    enabled: canPreview,
    keepPrevious: true,
    retry: false,
    staleTime: 60_000,
  });
  const previewCurrent = canPreview && previewInput === debouncedInput && !preview.isFetching && !preview.error ? preview.data : undefined;

  // Основа новой версии — последняя сохранённая версия (или пустая смета).
  useEffect(() => {
    if (values || !detail.data) return;
    if (latestSummary && !latest.data) return;
    setBase(latest.data ?? null);
    setValues(latest.data ? quoteToForm(latest.data, i18n.language) : emptyQuoteForm(detail.data.guests));
  }, [values, detail.data, latestSummary, latest.data, i18n.language]);

  const save = useApiMutation((input: Parameters<typeof banquetsApi.saveQuote>[1]) => banquetsApi.saveQuote(id, input), {
    onSuccess: async (quote) => {
      dirty.current = false;
      void message.success(t('banquets.quote.editor.saved', { version: quote.version, total: formatMoney(quote.totals.total, i18n.language) }));
      await invalidate();
      navigate(`/banquets/${id}?tab=quote&quote=${quote.id}`);
    },
  });

  if (detail.isLoading || (latestSummary && latest.isLoading)) return <PageLoader />;
  if (detail.error) return <ErrorAlert error={detail.error} onRetry={() => void detail.refetch()} />;
  if (latest.error) return <ErrorAlert error={latest.error} onRetry={() => void latest.refetch()} />;
  const request = detail.data;
  if (!request || !values) return <PageLoader />;

  const editable = request.canEditQuote;
  const branchId = request.branchId;

  const change = (next: QuoteFormValues) => {
    dirty.current = true;
    setValues(next);
  };
  const updateLine = (index: number, patch: Partial<QuoteLineForm>) => change({ ...values, lines: values.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) });
  const addDish = (dish: DishOption) => change({ ...values, lines: [...values.lines, newMenuLine(dish, request.guests)] });
  const addCustom = (kind: (typeof CUSTOM_LINE_KINDS)[number]) => change({ ...values, lines: [...values.lines, newCustomLine(kind)] });

  const issueText = (issue: QuoteFormIssue) => {
    const text = t(`banquets.quote.editor.issues.${issue.code}`);
    return issue.line ? t('banquets.quote.editor.lineIssue', { line: issue.line, message: text }) : text;
  };

  const submit = () => {
    const result = formToSaveInput(values);
    if (!result.ok) {
      setIssues(result.issues);
      return;
    }
    setIssues([]);
    save.mutate(result.input);
  };

  const has = (line: number, field: QuoteFormIssue['field']) => lineIssues(issues, line).some((i) => i.field === field);
  const vatSource = preview.data ?? base;
  const vatInfo = vatSource
    ? vatSource.vatPayer
      ? t('banquets.quote.editor.vatPayer', { percent: bpToPercentText(vatSource.vatRateBp, i18n.language) })
      : t('banquets.quote.editor.vatNone')
    : t('banquets.quote.editor.vatUnknown');
  const recalculating = canPreview && (previewInput !== debouncedInput || preview.isFetching);

  return (
    <>
      <Link to={`/banquets/${id}?tab=quote`}>
        <ArrowLeftOutlined /> {request.number}
      </Link>
      <PageHeader
        title={t('banquets.quote.editor.title')}
        subtitle={
          <Space wrap>
            {t('banquets.quote.editor.subtitle', { number: request.number, guests: request.guests })}
            <StatusTag domain="banquet" status={request.status} />
            {base
              ? t('banquets.quote.editor.basedOn', { version: base.version, total: formatMoney(base.totals.total, i18n.language) })
              : t('banquets.quote.editor.fromScratch')}
          </Space>
        }
        extra={
          <>
            <Button onClick={() => navigate(`/banquets/${id}?tab=quote`)}>{t('common.cancel')}</Button>
            <Button type="primary" loading={save.isPending} disabled={!editable} onClick={submit}>
              {t('banquets.quote.editor.save')}
            </Button>
          </>
        }
      />
      {!editable ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message={abilities.manage ? t('banquets.quote.editor.notEditable', { status: t(`statuses.banquet.${request.status}`) }) : t('banquets.common.noAccess')}
        />
      ) : null}
      {issues.length > 0 ? (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
          message={t('banquets.quote.editor.issuesTitle')}
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {issues.map((issue, i) => (
                <li key={`${issue.code}-${issue.line ?? 0}-${i}`}>{issueText(issue)}</li>
              ))}
            </ul>
          }
        />
      ) : null}
      <Card
        size="small"
        style={{ marginBottom: 16 }}
        title={
          <Space wrap>
            {branchId ? (
              <DishSearchSelect branchId={branchId} onPick={addDish} disabled={!editable} />
            ) : (
              <Typography.Text type="secondary">{t('banquets.quote.editor.noBranch')}</Typography.Text>
            )}
            <Dropdown
              disabled={!editable}
              menu={{
                items: CUSTOM_LINE_KINDS.map((kind) => ({ key: kind, label: t(`banquets.quote.kinds.${kind}`) })),
                onClick: ({ key }) => addCustom(key as (typeof CUSTOM_LINE_KINDS)[number]),
              }}
            >
              <Button icon={<PlusOutlined />}>{t('banquets.quote.editor.addCustom')}</Button>
            </Dropdown>
          </Space>
        }
      >
        {values.lines.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('banquets.quote.editor.issues.noLines')} />
        ) : (
          <Table<QuoteLineForm>
            className="aula-bq-lines"
            size="small"
            rowKey="key"
            pagination={false}
            dataSource={values.lines}
            scroll={{ x: 'max-content' }}
            columns={[
              { title: t('banquets.quote.columns.position'), key: 'n', width: 40, render: (_, __, index) => index + 1 },
              {
                title: t('banquets.quote.columns.item'),
                key: 'item',
                render: (_, line, index) =>
                  line.kind === 'menu' ? (
                    <Space direction="vertical" size={2} style={{ minWidth: 220 }}>
                      <Typography.Text strong>{translate(line.dishName, i18n.language)}</Typography.Text>
                      <Space size={4} wrap>
                        <Tag color="gold" style={{ marginInlineEnd: 0 }}>
                          {t('banquets.quote.kinds.menu')}
                        </Tag>
                        {line.availability && line.availability !== 'available' ? (
                          <Tag color="red" style={{ marginInlineEnd: 0 }}>
                            {t('banquets.quote.editor.stopped')}
                          </Tag>
                        ) : null}
                      </Space>
                    </Space>
                  ) : (
                    <Space direction="vertical" size={4} style={{ minWidth: 240 }}>
                      <Select
                        size="small"
                        value={line.kind}
                        disabled={!editable}
                        onChange={(kind) => updateLine(index, { kind })}
                        options={CUSTOM_LINE_KINDS.map((kind) => ({ value: kind, label: t(`banquets.quote.kinds.${kind}`) }))}
                        style={{ width: 160 }}
                      />
                      <Input
                        size="small"
                        lang="ru"
                        placeholder={`${t('banquets.quote.editor.lineTitle')} · ${t('translatable.ru')}`}
                        value={line.title.ru ?? ''}
                        status={has(index + 1, 'title') ? 'error' : undefined}
                        disabled={!editable}
                        onChange={(e) => updateLine(index, { title: { ...line.title, ru: e.target.value } })}
                        maxLength={300}
                      />
                      <Input
                        size="small"
                        lang="kk"
                        placeholder={`${t('banquets.quote.editor.lineTitle')} · ${t('translatable.kk')}`}
                        value={line.title.kk ?? ''}
                        status={has(index + 1, 'title') ? 'error' : undefined}
                        disabled={!editable}
                        onChange={(e) => updateLine(index, { title: { ...line.title, kk: e.target.value } })}
                        maxLength={300}
                      />
                    </Space>
                  ),
              },
              {
                title: t('banquets.quote.editor.unit'),
                key: 'unit',
                render: (_, line, index) => (
                  <Input
                    size="small"
                    value={line.unit}
                    placeholder={t('banquets.quote.editor.unitPlaceholder')}
                    status={has(index + 1, 'unit') ? 'error' : undefined}
                    disabled={!editable}
                    maxLength={20}
                    onChange={(e) => updateLine(index, { unit: e.target.value })}
                    style={{ width: 90 }}
                  />
                ),
              },
              {
                title: t('banquets.quote.editor.quantity'),
                key: 'quantity',
                render: (_, line, index) => (
                  <InputNumber
                    size="small"
                    min={1}
                    max={100_000}
                    precision={0}
                    value={line.quantity}
                    status={has(index + 1, 'quantity') ? 'error' : undefined}
                    disabled={!editable}
                    onChange={(quantity) => updateLine(index, { quantity: typeof quantity === 'number' ? quantity : null })}
                    style={{ width: 90 }}
                  />
                ),
              },
              {
                title: t('banquets.quote.editor.unitPrice'),
                key: 'price',
                render: (_, line, index) =>
                  isCustomKind(line.kind) ? (
                    <MoneyInput
                      size="small"
                      value={line.unitPrice}
                      status={has(index + 1, 'unitPrice') ? 'error' : undefined}
                      disabled={!editable}
                      onChange={(unitPrice) => updateLine(index, { unitPrice })}
                      style={{ width: 140 }}
                    />
                  ) : (
                    <Tooltip title={t('banquets.quote.editor.priceHint')}>
                      <Space direction="vertical" size={0}>
                        <Typography.Text style={{ whiteSpace: 'nowrap' }}>{formatMoney(line.shownPrice, i18n.language)}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {line.priceSource === 'snapshot' ? t('banquets.quote.editor.priceSnapshot') : t('banquets.quote.editor.priceMenu')}
                        </Typography.Text>
                      </Space>
                    </Tooltip>
                  ),
              },
              {
                title: t('banquets.quote.editor.discount'),
                key: 'discount',
                render: (_, line, index) => (
                  <DiscountField size="small" value={line.discount} invalid={has(index + 1, 'discount')} onChange={(discount) => updateLine(index, { discount })} />
                ),
              },
              {
                title: t('banquets.quote.columns.total'),
                key: 'total',
                align: 'right',
                render: (_, __, index) => {
                  const total = previewLineTotal(previewCurrent, index, values.lines.length);
                  return total ? <MoneyText value={total} strong /> : <Typography.Text type="secondary">—</Typography.Text>;
                },
              },
              {
                title: '',
                key: 'actions',
                render: (_, __, index) =>
                  editable ? (
                    <Space size={2}>
                      <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} aria-label={t('banquets.quote.editor.moveUp')} onClick={() => change({ ...values, lines: moveLine(values.lines, index, -1) })} />
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowDownOutlined />}
                        disabled={index === values.lines.length - 1}
                        aria-label={t('banquets.quote.editor.moveDown')}
                        onClick={() => change({ ...values, lines: moveLine(values.lines, index, 1) })}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t('banquets.quote.editor.remove')}
                        onClick={() => change({ ...values, lines: values.lines.filter((_, i) => i !== index) })}
                      />
                    </Space>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card size="small" title={t('banquets.quote.editor.overall')}>
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">{t('banquets.quote.editor.overallDiscount')}</Typography.Text>
                <div>
                  <DiscountField value={values.discount} invalid={issues.some((i) => !i.line && i.field === 'discount')} onChange={(discount) => change({ ...values, discount })} />
                </div>
              </Col>
              <Col xs={12} sm={6}>
                <Typography.Text type="secondary">{t('banquets.quote.editor.serviceCharge')}</Typography.Text>
                <Input
                  value={values.serviceCharge}
                  inputMode="decimal"
                  suffix="%"
                  placeholder="0"
                  disabled={!editable}
                  status={issues.some((i) => i.field === 'serviceCharge') ? 'error' : undefined}
                  onChange={(e) => change({ ...values, serviceCharge: e.target.value })}
                />
                <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                  {t('banquets.quote.editor.serviceHint')}
                </Typography.Text>
              </Col>
              <Col xs={12} sm={6}>
                <Typography.Text type="secondary">{t('banquets.quote.editor.guests')}</Typography.Text>
                <InputNumber
                  min={1}
                  max={5000}
                  precision={0}
                  value={values.guests}
                  disabled={!editable}
                  status={issues.some((i) => i.field === 'guests') ? 'error' : undefined}
                  onChange={(guests) => change({ ...values, guests: typeof guests === 'number' ? guests : null })}
                  style={{ width: '100%' }}
                />
              </Col>
              <Col xs={24} sm={12}>
                <Typography.Text type="secondary">{t('banquets.quote.editor.validUntil')}</Typography.Text>
                <DatePicker
                  format="DD.MM.YYYY"
                  style={{ width: '100%' }}
                  placeholder={t('banquets.quote.editor.validUntilHint')}
                  value={values.validUntil ? dayjs(values.validUntil) : null}
                  disabled={!editable}
                  disabledDate={(d) => d.isBefore(dayjs(todayLocal()), 'day')}
                  onChange={(d) => change({ ...values, validUntil: d ? d.format('YYYY-MM-DD') : null })}
                />
              </Col>
              <Col xs={24} sm={12}>
                {base ? (
                  <Checkbox checked={values.refreshMenuPrices} disabled={!editable} onChange={(e) => change({ ...values, refreshMenuPrices: e.target.checked })} style={{ marginTop: 22 }}>
                    <Tooltip title={t('banquets.quote.editor.refreshPricesHint')}>{t('banquets.quote.editor.refreshPrices')}</Tooltip>
                  </Checkbox>
                ) : null}
              </Col>
              <Col xs={24}>
                <Typography.Text type="secondary">{t('banquets.quote.editor.notes')}</Typography.Text>
                <Input.TextArea
                  rows={3}
                  maxLength={4000}
                  showCount
                  value={values.notes}
                  disabled={!editable}
                  onChange={(e) => change({ ...values, notes: e.target.value })}
                />
              </Col>
            </Row>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title={t('banquets.quote.editor.totalsTitle')}>
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert type="info" showIcon message={t('banquets.quote.editor.totalsServer')} />
              <Typography.Text>{vatInfo}</Typography.Text>
              {editable ? (
                <Card
                  size="small"
                  type="inner"
                  title={t('banquets.quote.editor.previewTitle')}
                  extra={recalculating ? <Typography.Text type="secondary">{t('banquets.quote.editor.recalculating')}</Typography.Text> : null}
                >
                  {previewInput === null ? (
                    <Typography.Text type="secondary">{t('banquets.quote.editor.previewIncomplete')}</Typography.Text>
                  ) : preview.error && !recalculating ? (
                    <Alert type="warning" showIcon message={errorMessage(toApiError(preview.error), i18n.language)} />
                  ) : preview.data ? (
                    <div style={{ opacity: recalculating ? 0.55 : 1, transition: 'opacity 0.2s' }}>
                      <QuoteTotals quote={preview.data} />
                    </div>
                  ) : (
                    <Typography.Text type="secondary">{t('banquets.quote.editor.recalculating')}</Typography.Text>
                  )}
                </Card>
              ) : null}
              {base ? (
                <>
                  <Flex justify="space-between">
                    <Typography.Text type="secondary">{t('banquets.quote.editor.basedOn', { version: base.version, total: formatMoney(base.totals.total, i18n.language) })}</Typography.Text>
                  </Flex>
                  <QuoteTotals quote={base} />
                </>
              ) : null}
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('banquets.quote.editor.priceHint')}
              </Typography.Text>
            </Space>
          </Card>
        </Col>
      </Row>
    </>
  );
}
