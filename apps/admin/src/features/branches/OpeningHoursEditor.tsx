import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Tag, TimePicker, Tooltip, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { WEEKDAYS, type OpeningHours, type OpeningInterval, type Weekday } from '@aula/api-client';
import { dayjs } from '@/shared/lib/dates';
import { copyDayToAll, isOvernight, validateOpeningHours } from './opening-hours';

const FORMAT = 'HH:mm';

/** Часы работы по дням недели с несколькими интервалами и переходом через полночь. Для Form.Item. */
export function OpeningHoursEditor({ value = {}, onChange }: { value?: OpeningHours; onChange?: (value: OpeningHours) => void }) {
  const { t } = useTranslation();
  const issues = validateOpeningHours(value);

  const setDay = (day: Weekday, intervals: OpeningInterval[]) => onChange?.({ ...value, [day]: intervals });

  return (
    <Flex vertical gap={4}>
      {WEEKDAYS.map((day) => {
        const intervals = value[day] ?? [];
        const dayIssues = issues[day] ?? [];
        return (
          <Flex key={day} gap={12} align="flex-start" wrap style={{ padding: '8px 0', borderBottom: '1px solid #f0e8dd' }}>
            <Typography.Text strong style={{ width: 120, paddingTop: 5 }}>
              {t(`weekdays.${day}`)}
            </Typography.Text>
            <Flex vertical gap={6} style={{ flex: 1, minWidth: 260 }}>
              {intervals.length === 0 ? <Typography.Text type="secondary" style={{ paddingTop: 5 }}>{t('branches.hours.closed')}</Typography.Text> : null}
              {intervals.map((interval, index) => (
                <Flex key={index} gap={6} align="center" wrap>
                  <TimePicker
                    aria-label={t('branches.hours.open')}
                    format={FORMAT}
                    minuteStep={5}
                    needConfirm={false}
                    allowClear={false}
                    value={interval.open ? dayjs(interval.open, FORMAT) : null}
                    onChange={(time) =>
                      setDay(day, intervals.map((it, i) => (i === index ? { ...it, open: time ? time.format(FORMAT) : '' } : it)))
                    }
                  />
                  <span>—</span>
                  <TimePicker
                    aria-label={t('branches.hours.close')}
                    format={FORMAT}
                    minuteStep={5}
                    needConfirm={false}
                    allowClear={false}
                    value={interval.close ? dayjs(interval.close, FORMAT) : null}
                    onChange={(time) =>
                      setDay(day, intervals.map((it, i) => (i === index ? { ...it, close: time ? time.format(FORMAT) : '' } : it)))
                    }
                  />
                  {interval.open && interval.close && isOvernight(interval) ? <Tag color="purple">{t('branches.hours.overnight')}</Tag> : null}
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label={t('common.delete')}
                    onClick={() => setDay(day, intervals.filter((_, i) => i !== index))}
                  />
                </Flex>
              ))}
              {dayIssues.length > 0 ? (
                <Typography.Text type="danger">{dayIssues.map((issue) => t(`branches.hours.issues.${issue}`)).join('; ')}</Typography.Text>
              ) : null}
            </Flex>
            <Flex gap={4}>
              <Tooltip title={t('branches.hours.addInterval')}>
                <Button
                  size="small"
                  icon={<PlusOutlined />}
                  aria-label={t('branches.hours.addInterval')}
                  onClick={() => setDay(day, [...intervals, { open: '10:00', close: '23:00' }])}
                />
              </Tooltip>
              <Tooltip title={t('branches.hours.copyToAll')}>
                <Button size="small" icon={<CopyOutlined />} aria-label={t('branches.hours.copyToAll')} onClick={() => onChange?.(copyDayToAll(value, day))} />
              </Tooltip>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  );
}
