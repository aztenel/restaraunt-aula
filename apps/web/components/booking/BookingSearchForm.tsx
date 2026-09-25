'use client';

import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { FormField, inputClass, useFieldErrorText } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { MinusIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { Link } from '@/i18n/navigation';
import { addDays, BOOKING_LIMITS, timeOptions, type BookingSearch, type SearchField } from '@/lib/booking';
import { routes } from '@/lib/routes';
import type { FormErrors } from '@/lib/validation';

export interface BookingBranch {
  id: string;
  slug: string;
  name: string;
  address: string;
  phone: string;
}

/**
 * Поиск свободных мест: филиал, дата, время, число гостей, тип места (необязательно).
 * Время — подсказка с шагом 30 минут; часы работы, окно брони и занятость проверяет сервер.
 */
export function BookingSearchForm({
  idPrefix,
  branches,
  search,
  today,
  nowTime,
  types,
  errors,
  loading,
  onChange,
  onSubmit,
}: {
  idPrefix: string;
  branches: BookingBranch[];
  search: BookingSearch;
  today: string;
  /** Текущее время филиала HH:mm — на сегодня не предлагать прошедшее время. */
  nowTime: string;
  types: Array<{ code: string; name: string }>;
  errors: FormErrors<SearchField>;
  loading: boolean;
  onChange: (patch: Partial<BookingSearch>) => void;
  onSubmit: () => void;
}) {
  const t = useTranslations('Booking');
  const fieldError = useFieldErrorText();
  const id = (field: string) => `${idPrefix}-${field}`;
  const times = timeOptions().filter((time) => search.date !== today || time > nowTime);
  const timeChoices = times.includes(search.time) || !search.time ? times : [search.time, ...times];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const setGuests = (value: number) => {
    if (Number.isNaN(value)) return;
    onChange({ guests: Math.max(BOOKING_LIMITS.guestsMin, Math.min(BOOKING_LIMITS.guestsMax, Math.trunc(value))) });
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-card border border-earth-100 bg-cream-50 p-4 shadow-card sm:p-5" aria-labelledby={id('title')}>
      <h2 id={id('title')} className="text-lg font-semibold text-earth-900">
        {t('searchTitle')}
      </h2>
      {branches.length > 1 ? (
        <FormField id={id('branchSlug')} label={t('branch')} error={fieldError(errors.branchSlug)}>
          <select id={id('branchSlug')} value={search.branchSlug} onChange={(e) => onChange({ branchSlug: e.target.value, typeCode: '' })} className={inputClass}>
            {branches.map((branch) => (
              <option key={branch.slug} value={branch.slug}>
                {branch.name} — {branch.address}
              </option>
            ))}
          </select>
        </FormField>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <FormField id={id('date')} label={t('date')} error={errors.date === 'past' ? t('datePast') : fieldError(errors.date)}>
          <input
            id={id('date')}
            type="date"
            value={search.date}
            min={today}
            max={addDays(today, BOOKING_LIMITS.daysAhead)}
            onChange={(e) => onChange({ date: e.target.value })}
            required
            aria-invalid={Boolean(errors.date)}
            className={inputClass}
          />
        </FormField>
        <FormField id={id('time')} label={t('time')} error={fieldError(errors.time)}>
          <select id={id('time')} value={search.time} onChange={(e) => onChange({ time: e.target.value })} aria-invalid={Boolean(errors.time)} className={inputClass}>
            {timeChoices.length === 0 ? <option value="">{t('noTimeToday')}</option> : null}
            {timeChoices.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={id('guests')} className="block text-sm font-semibold text-earth-800">
            {t('guests')}
          </label>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGuests(search.guests - 1)}
              disabled={search.guests <= BOOKING_LIMITS.guestsMin}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('guestsLess')}
            >
              <MinusIcon size={18} />
            </button>
            <input
              id={id('guests')}
              type="number"
              inputMode="numeric"
              min={BOOKING_LIMITS.guestsMin}
              max={BOOKING_LIMITS.guestsMax}
              value={search.guests}
              onChange={(e) => setGuests(e.target.valueAsNumber)}
              aria-invalid={Boolean(errors.guests)}
              aria-describedby={`${id('guests')}-hint`}
              className="block min-h-12 w-20 rounded-xl border border-earth-200 bg-cream-50 px-3 text-center text-base text-earth-900"
            />
            <button
              type="button"
              onClick={() => setGuests(search.guests + 1)}
              disabled={search.guests >= BOOKING_LIMITS.guestsMax}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('guestsMore')}
            >
              <PlusIcon size={18} />
            </button>
          </div>
          <p id={`${id('guests')}-hint`} className="mt-1 text-xs text-muted">
            {t.rich('guestsHint', {
              max: BOOKING_LIMITS.guestsMax,
              link: (chunks) => (
                <Link href={routes.banquets()} className="font-semibold text-earth-700 underline underline-offset-4">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        </div>
        {types.length > 1 ? (
          <FormField id={id('typeCode')} label={t('venueType')} optional>
            <select id={id('typeCode')} value={search.typeCode} onChange={(e) => onChange({ typeCode: e.target.value })} className={inputClass}>
              <option value="">{t('anyType')}</option>
              {types.map((type) => (
                <option key={type.code} value={type.code}>
                  {type.name}
                </option>
              ))}
            </select>
          </FormField>
        ) : null}
      </div>

      <button type="submit" disabled={loading} className={buttonClasses('primary', 'lg', 'w-full')}>
        <SearchIcon size={18} />
        {loading ? t('searching') : t('search')}
      </button>
    </form>
  );
}
