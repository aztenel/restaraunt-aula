'use client';

import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { ConsentFields } from '@/components/forms/ConsentFields';
import { FormError, FormField, inputClass, useFieldErrorText } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, PhoneIcon } from '@/components/ui/icons';
import type { AppLocale } from '@/i18n/routing';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, retryAfterMinutes } from '@/lib/api-errors';
import type { BanquetEventType, BanquetRequestCreated } from '@/lib/api-types';
import {
  BANQUET_FIELD_ORDER,
  BANQUET_LIMITS,
  banquetFieldForError,
  emptyBanquetForm,
  toBanquetRequestBody,
  validateBanquetForm,
  type BanquetField,
  type BanquetFormValues,
} from '@/lib/banquets';
import { addDays, localDate } from '@/lib/booking';
import { readBranchCookie } from '@/lib/branch-cookie';
import { formatPhone, telHref } from '@/lib/format';
import { Goals, reachGoal } from '@/lib/goals';
import { firstError, hasErrors, type FormErrors } from '@/lib/validation';

export interface BanquetBranch {
  id: string;
  slug: string;
  name: string;
  address: string;
}

/**
 * Заявка на банкет или выездное обслуживание → POST /public/banquets/requests → номер заявки
 * и контакты назначенного менеджера. Бюджет — в тенге, в API уходит в тиынах (parseFixed2).
 */
export function BanquetRequestForm({ eventTypes, branches, initialType }: { eventTypes: BanquetEventType[]; branches: BanquetBranch[]; initialType?: string }) {
  const t = useTranslations('Banquets.form');
  const apiErrors = useTranslations('ApiErrors');
  const fieldError = useFieldErrorText();
  const locale = useLocale() as AppLocale;
  const idPrefix = `banquet${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [values, setValues] = useState<BanquetFormValues>(() => ({ ...emptyBanquetForm(branches[0]?.id ?? ''), eventType: initialType ?? '' }));
  const [errors, setErrors] = useState<FormErrors<BanquetField>>({});
  const [serverField, setServerField] = useState<{ field: BanquetField; text: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<BanquetRequestCreated | null>(null);
  const [today, setToday] = useState('');
  const doneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setToday(localDate(new Date()));
    const slug = readBranchCookie();
    const preferred = branches.find((b) => b.slug === slug);
    if (preferred) setValues((v) => ({ ...v, branchId: preferred.id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, []);

  useEffect(() => {
    if (initialType) setValues((v) => ({ ...v, eventType: initialType }));
  }, [initialType]);

  useEffect(() => {
    if (created) doneRef.current?.focus();
  }, [created]);

  const change = (patch: Partial<BanquetFormValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch)) delete next[key as BanquetField];
      return next;
    });
    if (serverField && Object.keys(patch).includes(serverField.field)) setServerField(null);
  };

  const focus = (field: BanquetField) => {
    window.setTimeout(() => {
      const el = document.getElementById(`${idPrefix}-${field}`);
      el?.focus();
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 50);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    const found = validateBanquetForm(values, localDate(new Date()));
    setErrors(found);
    setServerField(null);
    if (hasErrors(found)) {
      setFormError(t('errorSummary'));
      const first = firstError(found, BANQUET_FIELD_ORDER);
      if (first) focus(first);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await call(getBrowserApi(locale).POST('/api/v1/public/banquets/requests', { body: toBanquetRequestBody(values, locale) }));
      reachGoal(Goals.BanquetRequest, { event_type: values.eventType, guests: Number(values.guests), offsite: values.place === 'offsite' });
      setCreated(result);
    } catch (e) {
      const error = toApiError(e);
      const minutes = retryAfterMinutes(error);
      const text = `${apiErrors(apiErrorKey(error, (k) => apiErrors.has(k)))}${minutes ? ` ${apiErrors('retryIn', { minutes })}` : ''}`;
      setFormError(text);
      const field = banquetFieldForError(error);
      if (field) {
        setServerField({ field, text });
        focus(field);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (created) {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="space-y-3 rounded-card border border-steppe-700/30 bg-steppe-100 p-6 text-steppe-700 focus:outline-none">
        <p className="flex items-center gap-2 text-xl font-semibold">
          <CheckIcon size={24} />
          {t('doneTitle', { number: created.number })}
        </p>
        <p className="text-earth-900">{t('doneText', { manager: created.managerName })}</p>
        {created.managerPhone ? (
          <a href={telHref(created.managerPhone)} className={buttonClasses('outline', 'sm')}>
            <PhoneIcon size={18} />
            {t('doneCall', { phone: formatPhone(created.managerPhone) })}
          </a>
        ) : null}
      </div>
    );
  }

  const error = (field: BanquetField) => {
    if (serverField?.field === field) return serverField.text;
    const code = errors[field];
    if (field === 'eventDate' && code === 'past') return t('datePast');
    if (field === 'budget' && code === 'invalid') return t('budgetInvalid');
    if (field === 'guests' && code === 'range') return t('guestsRange', { max: BANQUET_LIMITS.guestsMax });
    return fieldError(code);
  };
  const id = (field: string) => `${idPrefix}-${field}`;

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-labelledby={id('title')}>
      <h2 id={id('title')} className="text-2xl font-semibold text-earth-900">
        {t('title')}
      </h2>

      <FormField id={id('eventType')} label={t('eventType')} error={error('eventType')}>
        <select
          id={id('eventType')}
          value={values.eventType}
          onChange={(e) => change({ eventType: e.target.value })}
          required
          aria-invalid={Boolean(error('eventType'))}
          className={inputClass}
        >
          <option value="">{t('chooseType')}</option>
          {eventTypes.map((type) => (
            <option key={type.code} value={type.code}>
              {type.label}
            </option>
          ))}
        </select>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id={id('eventDate')} label={t('eventDate')} error={error('eventDate')}>
          <input
            id={id('eventDate')}
            type="date"
            value={values.eventDate}
            min={today || undefined}
            max={today ? addDays(today, 730) : undefined}
            onChange={(e) => change({ eventDate: e.target.value })}
            required
            aria-invalid={Boolean(error('eventDate'))}
            className={inputClass}
          />
        </FormField>
        <FormField id={id('eventTime')} label={t('eventTime')} error={error('eventTime')} optional>
          <input
            id={id('eventTime')}
            type="time"
            value={values.eventTime}
            onChange={(e) => change({ eventTime: e.target.value })}
            aria-invalid={Boolean(error('eventTime'))}
            className={inputClass}
          />
        </FormField>
        <FormField id={id('guests')} label={t('guests')} error={error('guests')}>
          <input
            id={id('guests')}
            inputMode="numeric"
            value={values.guests}
            onChange={(e) => change({ guests: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            required
            aria-invalid={Boolean(error('guests'))}
            className={inputClass}
          />
        </FormField>
      </div>

      <fieldset>
        <legend className="text-sm font-semibold text-earth-800">{t('place')}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(['branch', 'offsite'] as const).map((place) => (
            <label
              key={place}
              className={clsx(
                'flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 py-2',
                values.place === place ? 'border-gold-500 bg-gold-200/30' : 'border-earth-100 bg-cream-50',
              )}
            >
              <input type="radio" name={id('place')} value={place} checked={values.place === place} onChange={() => change({ place })} className="h-5 w-5 accent-earth-700" />
              <span>
                <span className="block font-semibold text-earth-900">{t(`places.${place}`)}</span>
                <span className="block text-xs text-muted">{t(`placesHint.${place}`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {values.place === 'branch' ? (
        <FormField id={id('branchId')} label={t('branch')} error={error('branchId')}>
          <select id={id('branchId')} value={values.branchId} onChange={(e) => change({ branchId: e.target.value })} aria-invalid={Boolean(error('branchId'))} className={inputClass}>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} — {branch.address}
              </option>
            ))}
          </select>
        </FormField>
      ) : (
        <FormField id={id('address')} label={t('address')} error={error('address')}>
          <input
            id={id('address')}
            value={values.address}
            onChange={(e) => change({ address: e.target.value.slice(0, BANQUET_LIMITS.addressMax) })}
            autoComplete="street-address"
            placeholder={t('addressPlaceholder')}
            aria-invalid={Boolean(error('address'))}
            className={inputClass}
          />
        </FormField>
      )}

      <FormField id={id('budget')} label={t('budget')} error={error('budget')} hint={t('budgetHint')} optional>
        <div className="relative mt-1">
          <input
            id={id('budget')}
            inputMode="decimal"
            value={values.budget}
            onChange={(e) => change({ budget: e.target.value.replace(/[^\d\s.,]/g, '').slice(0, 20) })}
            aria-invalid={Boolean(error('budget'))}
            aria-describedby={error('budget') ? `${id('budget')}-error` : `${id('budget')}-hint`}
            className="block min-h-12 w-full rounded-xl border border-earth-200 bg-cream-50 px-3 pr-10 text-base text-earth-900 aria-[invalid=true]:border-terracotta-500"
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-earth-500" aria-hidden="true">
            ₸
          </span>
        </div>
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id={id('name')} label={t('name')} error={error('name')}>
          <input
            id={id('name')}
            value={values.name}
            onChange={(e) => change({ name: e.target.value.slice(0, BANQUET_LIMITS.nameMax) })}
            autoComplete="name"
            required
            aria-invalid={Boolean(error('name'))}
            className={inputClass}
          />
        </FormField>
        <FormField id={id('phone')} label={t('phone')} error={error('phone')}>
          <input
            id={id('phone')}
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(e) => change({ phone: e.target.value.slice(0, 32) })}
            autoComplete="tel"
            placeholder="+7 7__ ___ __ __"
            required
            aria-invalid={Boolean(error('phone'))}
            className={inputClass}
          />
        </FormField>
      </div>
      <FormField id={id('email')} label={t('email')} error={error('email')} optional>
        <input
          id={id('email')}
          type="email"
          inputMode="email"
          value={values.email}
          onChange={(e) => change({ email: e.target.value.slice(0, 200) })}
          autoComplete="email"
          aria-invalid={Boolean(error('email'))}
          className={inputClass}
        />
      </FormField>
      <FormField id={id('wishes')} label={t('wishes')} error={error('wishes')} optional>
        <textarea
          id={id('wishes')}
          value={values.wishes}
          onChange={(e) => change({ wishes: e.target.value.slice(0, BANQUET_LIMITS.wishesMax) })}
          rows={4}
          placeholder={t('wishesPlaceholder')}
          aria-invalid={Boolean(error('wishes'))}
          className={`${inputClass} py-2`}
        />
      </FormField>

      <ConsentFields
        idPrefix={idPrefix}
        personalData={values.consentPersonalData}
        marketing={values.consentMarketing}
        onChange={(patch) =>
          change({
            ...(patch.personalData !== undefined ? { consentPersonalData: patch.personalData } : {}),
            ...(patch.marketing !== undefined ? { consentMarketing: patch.marketing } : {}),
          })
        }
        error={error('consentPersonalData')}
      />

      {formError ? <FormError>{formError}</FormError> : null}
      <button type="submit" disabled={submitting} className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
        {submitting ? t('submitting') : t('submit')}
      </button>
      <p className="text-sm text-muted">{t('sla')}</p>
    </form>
  );
}
