import { DatePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import { useTranslation } from 'react-i18next';

/** Дата и время начала/окончания (стенные часы Asia/Almaty), для Form.Item. */
export function DateTimeInput({ value, onChange, placeholder }: { value?: Dayjs | null; onChange?: (value: Dayjs | null) => void; placeholder?: string }) {
  const { t } = useTranslation();
  return (
    <DatePicker
      showTime={{ format: 'HH:mm', minuteStep: 5 }}
      format="DD.MM.YYYY HH:mm"
      allowClear
      value={value ?? null}
      onChange={(next) => onChange?.(next ?? null)}
      placeholder={placeholder ?? t('content.noLimit')}
      style={{ width: '100%' }}
    />
  );
}
