import { DatePicker, Flex, Input, Modal, Radio, Tag, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translate, type BranchMenuItem } from '@aula/api-client';
import { dayjs, isoToPickerValue, pickerValueToIso } from '@/shared/lib/dates';
import { MAX_STOP_DAYS, resolveStopUntil, STOP_PRESETS, type StopPreset, type StopUntilPayload } from './stop-until';

/** Быстрые причины стопа (текст сохраняется как причина — на языке интерфейса). */
const QUICK_REASONS = ['outOfStock', 'noIngredients', 'equipment', 'quality'] as const;
const MAX_REASON = 500;

export interface StopDialogResult extends StopUntilPayload {
  reason: string | null;
}

/**
 * Постановка в стоп (или изменение срока): «до конца дня» по умолчанию, 1–2 часа, до ручного возврата,
 * своё время (не дальше 30 дней); причина — быстрые варианты или свой текст. Крупные элементы для планшета.
 */
export function StopDialog({
  item,
  loading,
  onCancel,
  onSubmit,
}: {
  item: BranchMenuItem | null;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (result: StopDialogResult) => void;
}) {
  const { t, i18n } = useTranslation();
  const [preset, setPreset] = useState<StopPreset>('end_of_day');
  const [custom, setCustom] = useState<Dayjs | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const editing = item?.availability === 'stopped';

  useEffect(() => {
    if (!item) return;
    setError(null);
    setReason(item.stopReason ?? '');
    if (item.availability === 'stopped' && item.stoppedUntil) {
      setPreset('custom');
      setCustom(isoToPickerValue(item.stoppedUntil));
    } else {
      setPreset(item.availability === 'stopped' ? 'manual' : 'end_of_day');
      setCustom(null);
    }
  }, [item]);

  const submit = () => {
    const customIso = pickerValueToIso(custom);
    const result = resolveStopUntil(preset, new Date(), customIso ? new Date(customIso) : null);
    if (!result.ok) {
      setError(t(`stopList.untilErrors.${result.error}`, { days: MAX_STOP_DAYS }));
      return;
    }
    onSubmit({ ...result.payload, reason: reason.trim() || null });
  };

  return (
    <Modal
      open={item !== null}
      title={item ? (editing ? t('stopList.dialog.editTitle', { name: translate(item.dishName, i18n.language) }) : t('stopList.dialog.title', { name: translate(item.dishName, i18n.language) })) : undefined}
      okText={editing ? t('common.save') : t('stopList.stop')}
      okButtonProps={{ danger: !editing, size: 'large', loading }}
      cancelButtonProps={{ size: 'large' }}
      cancelText={t('common.cancel')}
      onOk={submit}
      onCancel={onCancel}
      destroyOnHidden
      width={560}
    >
      <Typography.Text strong>{t('stopList.dialog.until')}</Typography.Text>
      <Radio.Group
        size="large"
        optionType="button"
        value={preset}
        onChange={(e) => {
          setPreset(e.target.value as StopPreset);
          setError(null);
        }}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0 12px' }}
        options={STOP_PRESETS.map((p) => ({ value: p, label: t(`stopList.presets.${p}`) }))}
      />
      {preset === 'custom' ? (
        <DatePicker
          size="large"
          showTime={{ format: 'HH:mm', minuteStep: 5 }}
          format="DD.MM.YYYY HH:mm"
          value={custom}
          onChange={(value) => {
            setCustom(value);
            setError(null);
          }}
          disabledDate={(date) => date.isBefore(dayjs().startOf('day')) || date.isAfter(dayjs().add(MAX_STOP_DAYS, 'day'))}
          style={{ width: '100%', marginBottom: 12 }}
          placeholder={t('stopList.dialog.customPlaceholder')}
        />
      ) : null}
      {error ? (
        <Typography.Paragraph type="danger" style={{ marginTop: -4 }}>
          {error}
        </Typography.Paragraph>
      ) : null}
      <Typography.Text strong>{t('stopList.dialog.reason')}</Typography.Text>
      <Flex wrap gap={8} style={{ margin: '8px 0' }}>
        {QUICK_REASONS.map((key) => {
          const text = t(`stopList.reasons.${key}`);
          return (
            <Tag.CheckableTag
              key={key}
              checked={reason === text}
              onChange={(checked) => setReason(checked ? text : '')}
              style={{ padding: '6px 12px', fontSize: 15, border: '1px solid #d9c6b0' }}
            >
              {text}
            </Tag.CheckableTag>
          );
        })}
      </Flex>
      <Input.TextArea
        rows={2}
        maxLength={MAX_REASON}
        showCount
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('stopList.dialog.reasonPlaceholder')}
      />
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t('stopList.dialog.note')}
      </Typography.Paragraph>
    </Modal>
  );
}
