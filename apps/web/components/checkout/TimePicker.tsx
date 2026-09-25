'use client';

import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { inputClass } from '@/components/forms/FormField';
import { Skeleton } from '@/components/ui/Skeleton';
import type { OrderSlots } from '@/lib/api-types';
import type { TimeMode } from '@/lib/checkout';
import { formatDateTime, formatLocalDate } from '@/lib/format';

/**
 * Время заказа: «как можно скорее» или слот ко времени из GET /public/branches/:id/order-slots
 * (часы работы и время приготовления учитывает сервер; при оформлении время проверяется снова).
 */
export function TimePicker({
  idPrefix,
  timeMode,
  scheduledDate,
  scheduledFor,
  slots,
  loading,
  failed,
  onAsap,
  onDate,
  onSlot,
  error,
}: {
  idPrefix: string;
  timeMode: TimeMode;
  scheduledDate: string | null;
  scheduledFor: string | null;
  slots: OrderSlots | null;
  loading: boolean;
  failed: boolean;
  onAsap: () => void;
  onDate: (date: string) => void;
  onSlot: (at: string | null) => void;
  error?: string;
}) {
  const t = useTranslations('Checkout.time');
  const locale = useLocale();
  const asap = slots?.asap;
  const asapDisabled = asap ? !asap.available : false;
  const radio = 'h-5 w-5 shrink-0 accent-earth-700';
  const date = scheduledDate ?? slots?.date ?? null;

  return (
    <fieldset aria-describedby={error ? `${idPrefix}-time-error` : undefined} aria-invalid={Boolean(error) || undefined}>
      <legend className="text-lg font-semibold text-earth-900">{t('title')}</legend>
      <div className="mt-2 space-y-2">
        <label className={clsx('flex min-h-11 items-start gap-3 rounded-2xl border p-3', timeMode === 'asap' ? 'border-earth-700 bg-cream-50' : 'border-earth-100', asapDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
          <input type="radio" name={`${idPrefix}-time`} checked={timeMode === 'asap'} onChange={onAsap} disabled={asapDisabled} className={clsx(radio, 'mt-0.5')} />
          <span>
            <span className="block font-semibold text-earth-900">{t('asap')}</span>
            {asap?.available && asap.readyAt ? <span className="block text-sm text-muted">{t('readyAt', { time: formatDateTime(asap.readyAt, locale) })}</span> : null}
            {asap && !asap.available ? (
              <span className="block text-sm text-terracotta-600">{asap.reason === 'closing_soon' ? t('closingSoon') : t('closed')}</span>
            ) : null}
          </span>
        </label>
        <label className={clsx('flex min-h-11 cursor-pointer items-start gap-3 rounded-2xl border p-3', timeMode === 'scheduled' ? 'border-earth-700 bg-cream-50' : 'border-earth-100')}>
          <input
            type="radio"
            name={`${idPrefix}-time`}
            checked={timeMode === 'scheduled'}
            onChange={() => onDate(date ?? slots?.dates[0] ?? '')}
            className={clsx(radio, 'mt-0.5')}
          />
          <span className="font-semibold text-earth-900">{t('scheduled')}</span>
        </label>
      </div>

      {timeMode === 'scheduled' ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`${idPrefix}-date`} className="block text-sm font-semibold text-earth-800">
              {t('date')}
            </label>
            <select
              id={`${idPrefix}-date`}
              value={date ?? ''}
              onChange={(e) => onDate(e.target.value)}
              className={inputClass}
              disabled={!slots || slots.dates.length === 0}
            >
              {(slots?.dates ?? []).map((d) => (
                <option key={d} value={d}>
                  {formatLocalDate(d, locale)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idPrefix}-slot`} className="block text-sm font-semibold text-earth-800">
              {t('slot')}
            </label>
            {loading ? (
              <Skeleton className="mt-1 h-12 w-full" />
            ) : (
              <select
                id={`${idPrefix}-slot`}
                value={scheduledFor ?? ''}
                onChange={(e) => onSlot(e.target.value || null)}
                className={inputClass}
                aria-invalid={Boolean(error)}
                disabled={!slots || slots.slots.length === 0}
              >
                <option value="">{slots && slots.slots.length === 0 ? t('noSlots') : t('chooseSlot')}</option>
                {(slots?.slots ?? []).map((slot) => (
                  <option key={slot.at} value={slot.at}>
                    {slot.time}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      ) : null}
      {failed ? <p className="mt-2 text-sm text-terracotta-600">{t('loadError')}</p> : null}
      {error ? (
        <p id={`${idPrefix}-time-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
