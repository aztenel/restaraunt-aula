import { Alert, App, Form, Modal, Radio, Space, Typography } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiMutation } from '@/shared/api/hooks';
import { dayjs, DISPLAY_TIMEZONE } from '@/shared/lib/dates';
import { saveBlob } from '@/shared/lib/download';
import { customersApi } from './api';
import { FilterSummary } from './CustomerTags';
import { fallbackExportName, planExport, toExportBody, type ExportNotice } from './export-rules';
import { EXPORT_FORMATS, EXPORT_PURPOSES, type CustomerFilterDto, type ExportFormat, type ExportPurpose } from './types';

const NOTICE_TYPE: Record<ExportNotice, 'info' | 'warning'> = {
  marketing_only_consented: 'info',
  marketing_consent_added: 'info',
  service_purpose_logged: 'warning',
  service_includes_unconsented: 'warning',
  anonymized_excluded: 'info',
  audit_logged: 'info',
  row_limit: 'info',
};

/**
 * Выгрузка гостей в XLSX/CSV (customers.export): цель обязательна — маркетинг (только с согласием на
 * рассылки) или сервис. Правила показываются до выгрузки; число строк — из заголовка X-Export-Count.
 */
export function ExportModal({
  refinements,
  segmentId,
  segmentName,
  effectiveFilter,
  onClose,
}: {
  /** Условия экрана (уточняют сегмент). */
  refinements: CustomerFilterDto;
  segmentId: string | null;
  segmentName: string | null;
  /** Сегмент + уточнения — то, что увидит сотрудник. */
  effectiveFilter: CustomerFilterDto;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [purpose, setPurpose] = useState<ExportPurpose>('marketing');
  const plan = planExport(purpose, effectiveFilter);

  const run = useApiMutation(() => customersApi.export(toExportBody(format, purpose, refinements, segmentId)), {
    onSuccess: (file) => {
      const today = dayjs().tz(DISPLAY_TIMEZONE).format('YYYY-MM-DD');
      saveBlob(file.blob, file.filename ?? fallbackExportName(purpose, format, today));
      void message.success(file.count === null ? t('customers.export.doneFile') : t('customers.export.done', { count: file.count }));
      onClose();
    },
  });

  return (
    <Modal
      open
      width={640}
      title={t('customers.export.title')}
      okText={t('customers.export.submit')}
      okButtonProps={{ loading: run.isPending, disabled: plan.blocker !== null }}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() => void run.mutateAsync().catch(() => undefined)}
      destroyOnHidden
    >
      <Form layout="vertical" requiredMark={false}>
        <Form.Item label={t('customers.export.source')}>
          <FilterSummary filter={plan.effectiveFilter} segmentName={segmentName} />
        </Form.Item>
        <Form.Item label={t('customers.export.purpose')}>
          <Radio.Group value={purpose} onChange={(e) => setPurpose(e.target.value as ExportPurpose)}>
            <Space direction="vertical">
              {EXPORT_PURPOSES.map((value) => (
                <Radio key={value} value={value}>
                  {t(`customers.export.purposes.${value}`)}
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item label={t('customers.export.format')}>
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            options={EXPORT_FORMATS.map((value) => ({ value, label: value.toUpperCase() }))}
          />
        </Form.Item>
      </Form>
      {plan.blocker ? <Alert type="error" showIcon style={{ marginBottom: 8 }} message={t(`customers.export.blocker.${plan.blocker}`)} /> : null}
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        {plan.notices.map((notice) => (
          <Alert key={notice} type={NOTICE_TYPE[notice]} showIcon message={<Typography.Text>{t(`customers.export.notices.${notice}`)}</Typography.Text>} />
        ))}
      </Space>
    </Modal>
  );
}
