import { Alert, App, Button, Checkbox, Col, DatePicker, Divider, Drawer, Form, Input, InputNumber, Row, Select, Space, Switch, TimePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toApiError } from '@aula/api-client';
import { errorMessage } from '@/shared/api/errors';
import { useNotifyError } from '@/shared/api/useNotifyError';
import { useBranch } from '@/shared/branch/BranchProvider';
import { currentLanguage } from '@/shared/i18n/language';
import { dayjs } from '@/shared/lib/dates';
import { BranchSelect } from '@/shared/ui/BranchSelect';
import { MoneyInput } from '@/shared/ui/MoneyInput';
import { useSectionAbilities } from '../abilities';
import { banquetsApi, banquetsKeys } from '../api';
import { todayLocal } from '../calendar-layout';
import { ManagerSelect } from '../common/ManagerSelect';
import { CompanySelect } from '../companies/CompanySelect';
import { EVENT_TYPES, type BanquetEventType, type BanquetRequestDetail } from '../types';
import {
  detailToForm,
  emptyRequestForm,
  toCreateInput,
  toUpdateInput,
  validateRequestForm,
  type RequestFormIssue,
  type RequestFormValues,
} from './request-form';

interface UiValues {
  eventDate?: Dayjs | null;
  eventTime?: Dayjs | null;
  eventType?: BanquetEventType | null;
  guests?: number | null;
  offsite: boolean;
  branchId?: string | null;
  address?: string;
  budget?: number | null;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  wishes?: string;
  companyId?: string | null;
  managerId?: string | null;
  locale: 'ru' | 'kk' | 'en';
  consentPersonalData: boolean;
  consentMarketing: boolean;
}

const FIELD_BY_ISSUE: Record<RequestFormIssue, keyof UiValues> = {
  eventDateRequired: 'eventDate',
  eventDateInPast: 'eventDate',
  eventDateTooFar: 'eventDate',
  eventTimeInvalid: 'eventTime',
  eventTypeRequired: 'eventType',
  guestsInvalid: 'guests',
  branchRequired: 'branchId',
  addressRequired: 'address',
  addressTooLong: 'address',
  budgetInvalid: 'budget',
  contactNameRequired: 'contactName',
  contactPhoneInvalid: 'contactPhone',
  contactEmailInvalid: 'contactEmail',
  wishesTooLong: 'wishes',
};

/** Ошибки сервера, которые относятся к полю формы. */
const FIELD_BY_ERROR: Record<string, keyof UiValues> = {
  'banquet.event_date_in_past': 'eventDate',
  'banquet.event_date_too_far': 'eventDate',
  'banquet.invalid_event_date': 'eventDate',
  'banquet.invalid_event_time': 'eventTime',
  'banquet.invalid_guests': 'guests',
  'banquet.branch_required': 'branchId',
  'banquet.unknown_branch': 'branchId',
  'banquet.offsite_address_required': 'address',
  'banquet.offsite_address_too_long': 'address',
  'banquet.invalid_budget': 'budget',
  'banquet.contact_name_invalid': 'contactName',
  'banquet.contact_email_invalid': 'contactEmail',
  'phone.invalid': 'contactPhone',
  'banquet.wishes_too_long': 'wishes',
  'banquet.manager_invalid': 'managerId',
};

function toUi(values: RequestFormValues): UiValues {
  return {
    eventDate: values.eventDate ? dayjs(values.eventDate) : null,
    eventTime: values.eventTime ? dayjs(`2000-01-01T${values.eventTime}`) : null,
    eventType: values.eventType,
    guests: values.guests,
    offsite: values.offsite,
    branchId: values.branchId,
    address: values.address,
    budget: values.budget,
    contactName: values.contactName,
    contactPhone: values.contactPhone,
    contactEmail: values.contactEmail,
    wishes: values.wishes,
    companyId: values.companyId,
    managerId: values.managerId,
    locale: values.locale,
    consentPersonalData: values.consentPersonalData,
    consentMarketing: values.consentMarketing,
  };
}

function fromUi(ui: UiValues): RequestFormValues {
  return {
    eventDate: ui.eventDate ? ui.eventDate.format('YYYY-MM-DD') : null,
    eventTime: ui.eventTime ? ui.eventTime.format('HH:mm') : null,
    eventType: ui.eventType ?? null,
    guests: ui.guests ?? null,
    offsite: ui.offsite,
    branchId: ui.branchId ?? null,
    address: ui.address ?? '',
    budget: ui.budget ?? null,
    contactName: ui.contactName ?? '',
    contactPhone: ui.contactPhone ?? '',
    contactEmail: ui.contactEmail ?? '',
    wishes: ui.wishes ?? '',
    companyId: ui.companyId ?? null,
    managerId: ui.managerId ?? null,
    locale: ui.locale,
    consentPersonalData: ui.consentPersonalData,
    consentMarketing: ui.consentMarketing,
  };
}

/** Новая заявка из админки (звонок, визит) или правка деталей существующей. */
export function RequestFormDrawer({
  open,
  request,
  onClose,
  onSaved,
}: {
  open: boolean;
  request: BanquetRequestDetail | null;
  onClose: () => void;
  onSaved: (detail: BanquetRequestDetail) => void;
}) {
  const { t, i18n } = useTranslation();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const notifyError = useNotifyError();
  const { selectedBranchId } = useBranch();
  const abilities = useSectionAbilities();
  const [form] = Form.useForm<UiValues>();
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const offsite = Form.useWatch('offsite', form) ?? false;
  const consent = Form.useWatch('consentPersonalData', form) ?? false;
  const editing = request !== null;

  useEffect(() => {
    if (!open) return;
    setConflict(null);
    form.resetFields();
    const lang = currentLanguage();
    form.setFieldsValue(toUi(request ? detailToForm(request) : emptyRequestForm({ branchId: selectedBranchId, locale: lang })));
  }, [open, request, form, selectedBranchId]);

  const submit = async () => {
    const ui = await form.validateFields();
    const values = fromUi(ui);
    const issues = validateRequestForm(values, { today: todayLocal(), originalEventDate: request?.eventDate ?? null });
    if (issues.length > 0) {
      const byField = new Map<keyof UiValues, string[]>();
      for (const issue of issues) {
        const field = FIELD_BY_ISSUE[issue];
        byField.set(field, [...(byField.get(field) ?? []), t(`banquets.form.issues.${issue}`)]);
      }
      form.setFields([...byField.entries()].map(([name, errors]) => ({ name, errors })));
      return;
    }
    setSaving(true);
    setConflict(null);
    try {
      const detail = request ? await banquetsApi.update(request.id, toUpdateInput(values)) : await banquetsApi.create(toCreateInput(values));
      queryClient.setQueryData(banquetsKeys.detail(detail.id), detail);
      await queryClient.invalidateQueries({ queryKey: banquetsKeys.all });
      void message.success(request ? t('banquets.form.saved') : t('banquets.form.created', { number: detail.number }));
      onSaved(detail);
    } catch (error) {
      const apiError = toApiError(error);
      const field = FIELD_BY_ERROR[apiError.code];
      if (apiError.code === 'reservation.venue_occupied' || apiError.code === 'banquet.venue_hold_exists') {
        setConflict(errorMessage(apiError, i18n.language));
      } else if (field) {
        form.setFields([{ name: field, errors: [errorMessage(apiError, i18n.language)] }]);
      } else {
        notifyError(error);
      }
    } finally {
      setSaving(false);
    }
  };

  const req = { required: true, message: t('common.required') };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={720}
      title={request ? t('banquets.form.editTitle', { number: request.number }) : t('banquets.form.createTitle')}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={saving} onClick={() => void submit()}>
            {editing ? t('common.save') : t('common.create')}
          </Button>
        </Space>
      }
    >
      {conflict ? <Alert type="error" showIcon message={conflict} style={{ marginBottom: 12 }} /> : null}
      <Form<UiValues> form={form} layout="vertical" requiredMark="optional">
        <Divider orientation="left" plain style={{ marginTop: 0 }}>
          {t('banquets.form.sectionEvent')}
        </Divider>
        <Row gutter={12}>
          <Col xs={12} sm={8}>
            <Form.Item name="eventDate" label={t('banquets.form.eventDate')} rules={[req]}>
              <DatePicker format="DD.MM.YYYY" style={{ width: '100%' }} disabledDate={(d) => !editing && d.isBefore(dayjs(todayLocal()), 'day')} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={6}>
            <Form.Item name="eventTime" label={t('banquets.form.eventTime')}>
              <TimePicker format="HH:mm" minuteStep={5} style={{ width: '100%' }} needConfirm={false} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={10}>
            <Form.Item name="eventType" label={t('banquets.form.eventType')} rules={[req]}>
              <Select options={EVENT_TYPES.map((type) => ({ value: type, label: t(`banquets.eventTypes.${type}`) }))} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="guests" label={t('banquets.form.guests')} rules={[req]}>
              <InputNumber min={1} max={5000} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="budget" label={t('banquets.form.budget')}>
              <MoneyInput />
            </Form.Item>
          </Col>
          <Col xs={24} sm={8}>
            <Form.Item name="offsite" label={t('banquets.form.offsite')} valuePropName="checked">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} sm={offsite ? 10 : 24}>
            <Form.Item name="branchId" label={offsite ? t('banquets.form.branchOffsite') : t('banquets.form.branch')} rules={offsite ? [] : [req]}>
              <BranchSelect allowClear={offsite} />
            </Form.Item>
          </Col>
          {offsite ? (
            <Col xs={24} sm={14}>
              <Form.Item name="address" label={t('banquets.form.address')} rules={[req, { max: 500 }]}>
                <Input maxLength={500} />
              </Form.Item>
            </Col>
          ) : null}
        </Row>
        <Divider orientation="left" plain>
          {t('banquets.form.sectionContact')}
        </Divider>
        <Row gutter={12}>
          <Col xs={24} sm={8}>
            <Form.Item name="contactName" label={t('banquets.form.contactName')} rules={[req, { max: 120 }]}>
              <Input maxLength={120} />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="contactPhone" label={t('banquets.form.contactPhone')} rules={[req]}>
              <Input inputMode="tel" maxLength={32} placeholder="+7 701 000 00 00" />
            </Form.Item>
          </Col>
          <Col xs={12} sm={8}>
            <Form.Item name="contactEmail" label={t('banquets.form.contactEmail')}>
              <Input inputMode="email" maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24}>
            <Form.Item name="companyId" label={t('banquets.form.company')} extra={t('banquets.form.companyHint')}>
              <CompanySelect allowClear allowCreate={abilities.companiesEdit} initialCompany={request?.company ?? null} />
            </Form.Item>
          </Col>
        </Row>
        <Divider orientation="left" plain>
          {t('banquets.form.sectionOther')}
        </Divider>
        <Form.Item name="wishes" label={t('banquets.form.wishes')}>
          <Input.TextArea rows={3} maxLength={4000} showCount />
        </Form.Item>
        {editing ? null : (
          <Row gutter={12}>
            <Col xs={24} sm={14}>
              <Form.Item name="managerId" label={t('banquets.form.manager')}>
                <ManagerSelect allowClear placeholder={t('banquets.form.managerAuto')} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={10}>
              <Form.Item name="locale" label={t('banquets.form.locale')}>
                <Select options={(['ru', 'kk', 'en'] as const).map((l) => ({ value: l, label: t(`banquets.locales.${l}`) }))} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="consentPersonalData" valuePropName="checked" extra={t('banquets.form.consentHint')} style={{ marginBottom: 4 }}>
                <Checkbox>{t('banquets.form.consent')}</Checkbox>
              </Form.Item>
              <Form.Item name="consentMarketing" valuePropName="checked">
                <Checkbox disabled={!consent}>{t('banquets.form.consentMarketing')}</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        )}
      </Form>
    </Drawer>
  );
}
