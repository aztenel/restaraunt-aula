'use client';

import clsx from 'clsx';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError } from '@aula/api-client';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { MinusIcon, PlusIcon } from '@/components/ui/icons';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, retryAfterMinutes } from '@/lib/api-errors';
import type { CertificateProduct } from '@/lib/api-types';
import {
  DELIVERY_CHANNELS,
  emptyCertificateForm,
  fieldErrorForApiError,
  fieldForApiError,
  firstErrorField,
  LIMITS,
  toPurchaseBody,
  validateCertificateForm,
  type CertificateField,
  type CertificateFormErrors,
  type CertificateFormValues,
} from '@/lib/certificates';
import { formatDate, formatPrice } from '@/lib/format';
import { routes } from '@/lib/routes';
import { randomUuid } from '@/lib/uuid';

export interface ConsentInfo {
  version: string;
  text: string;
  publishedAt: string;
}

const inputClass =
  'mt-1 block h-12 w-full rounded-xl border bg-cream-50 px-3 text-base text-earth-900 placeholder:text-earth-400 aria-[invalid=true]:border-terracotta-500';

function Field({
  id,
  label,
  error,
  hint,
  optionalLabel,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Подпись «необязательно» для необязательных полей. */
  optionalLabel?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-earth-800">
        {label}
        {optionalLabel ? <span className="font-normal text-muted"> · {optionalLabel}</span> : null}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm font-semibold text-terracotta-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Покупка подарочного сертификата: продукт, количество, покупатель, получатель, пожелание,
 * способ отправки и ОБЯЗАТЕЛЬНОЕ согласие на обработку ПД (текст — GET /public/consents/personal_data).
 * Отправка: POST /public/certificates/purchase с ключом идемпотентности (новый при изменении данных,
 * тот же при повторе после обрыва связи) → страница заказа, которая дождётся ссылки на оплату.
 */
export function CertificatePurchaseForm({ products, consent }: { products: CertificateProduct[]; consent: ConsentInfo | null }) {
  const t = useTranslations('CertificateForm');
  const certs = useTranslations('Certificates');
  const common = useTranslations('Common');
  const apiErrors = useTranslations('ApiErrors');
  const locale = useLocale();
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<CertificateFormValues>(() => emptyCertificateForm(products[0]?.id ?? ''));
  const [errors, setErrors] = useState<CertificateFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKey = useRef<string | null>(null);

  const fieldId = (field: CertificateField) => `${id}-${field}`;
  const product = products.find((p) => p.id === values.productId) ?? null;

  const update = <K extends CertificateField>(field: K, value: CertificateFormValues[K]) => {
    // Новые данные — новая попытка оформления (новый ключ идемпотентности).
    idempotencyKey.current = null;
    const next = { ...values, [field]: value };
    setValues(next);
    // После первой попытки отправки ошибки обновляются по мере исправления.
    if (submitted) setErrors(validateCertificateForm(next));
  };

  const errorText = (field: CertificateField): string | undefined => {
    const code = errors[field];
    return code ? t(`errors.${code}`) : undefined;
  };

  const describedBy = (field: CertificateField, hint = false) =>
    errors[field] ? `${fieldId(field)}-error` : hint ? `${fieldId(field)}-hint` : undefined;

  const focusField = (field: CertificateField) => {
    const target =
      field === 'productId' || field === 'deliveryChannel'
        ? document.querySelector<HTMLInputElement>(`[name="${fieldId(field)}"]:checked, [name="${fieldId(field)}"]`)
        : document.getElementById(fieldId(field));
    target?.focus();
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitted(true);
    const found = validateCertificateForm(values);
    setErrors(found);
    const first = firstErrorField(found);
    if (first) {
      setFormError(t('errorSummary'));
      focusField(first);
      return;
    }
    setFormError(null);
    idempotencyKey.current ??= randomUuid();
    setSubmitting(true);
    try {
      const api = getBrowserApi(locale);
      const result = (await call(
        api.POST('/api/v1/public/certificates/purchase', {
          body: toPurchaseBody(values, { locale, idempotencyKey: idempotencyKey.current }),
        }),
      ));
      // Ссылка на оплату появляется асинхронно — страница заказа дождётся её и перенаправит.
      router.push({ pathname: routes.certificateOrder(result.orderToken), query: { pay: '1' } });
    } catch (error) {
      const apiError = toApiError(error);
      const field = fieldForApiError(apiError, values);
      if (field) {
        setErrors((current) => ({ ...current, [field]: fieldErrorForApiError(apiError) }));
        focusField(field);
      }
      const key = apiErrorKey(apiError, (k) => apiErrors.has(k));
      const minutes = retryAfterMinutes(apiError);
      setFormError(`${apiErrors(key)}${minutes ? ` ${apiErrors('retryIn', { minutes })}` : ''}`);
      // Сервер отклонил данные — заказ не создан; при обрыве связи ключ сохраняется (повтор не создаст второй заказ).
      if (!apiError.isNetworkError) idempotencyKey.current = null;
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8" aria-describedby={formError ? `${id}-form-error` : undefined}>
      <fieldset aria-describedby={describedBy('productId')}>
        <legend className="text-lg font-semibold text-earth-900">{t('product')}</legend>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {products.map((p) => {
            const selected = p.id === values.productId;
            const differentPrice = p.price.amount !== p.nominal.amount;
            return (
              <li key={p.id}>
                <label
                  className={clsx(
                    'flex h-full cursor-pointer flex-col rounded-card border-2 bg-cream-50 p-4 transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-500',
                    selected ? 'border-earth-700 shadow-card' : 'border-earth-100 hover:border-gold-400',
                  )}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={fieldId('productId')}
                        value={p.id}
                        checked={selected}
                        onChange={() => update('productId', p.id)}
                        className="h-5 w-5 shrink-0 accent-earth-700"
                      />
                      <span className="font-display text-lg font-semibold text-earth-900">{p.name}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-gold-200 px-2 py-0.5 text-xs font-bold text-gold-700">
                      {p.kind === 'set' ? certs('kindSet') : certs('kindAmount')}
                    </span>
                  </span>
                  <span className="mt-2 text-2xl font-bold tabular-nums text-earth-900">{formatPrice(p.price, locale)}</span>
                  {differentPrice ? (
                    <span className="text-sm text-muted">
                      {certs('nominal')}: {formatPrice(p.nominal, locale)}
                    </span>
                  ) : null}
                  {p.description ? <span className="mt-2 text-sm text-earth-700">{p.description}</span> : null}
                  <span className="mt-auto pt-2 text-xs text-muted">{certs('validity', { months: p.validityMonths })}</span>
                </label>
              </li>
            );
          })}
        </ul>
        {errors.productId ? (
          <p id={`${fieldId('productId')}-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
            {errorText('productId')}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <div>
          <span id={`${fieldId('quantity')}-label`} className="block text-sm font-semibold text-earth-800">
            {t('quantity')}
          </span>
          <div className="mt-1 flex items-center gap-1" role="group" aria-labelledby={`${fieldId('quantity')}-label`}>
            <button
              type="button"
              onClick={() => update('quantity', Math.max(LIMITS.quantityMin, values.quantity - 1))}
              disabled={values.quantity <= LIMITS.quantityMin}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('decrease')}
            >
              <MinusIcon size={18} />
            </button>
            <output id={fieldId('quantity')} className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">
              {values.quantity}
            </output>
            <button
              type="button"
              onClick={() => update('quantity', Math.min(LIMITS.quantityMax, values.quantity + 1))}
              disabled={values.quantity >= LIMITS.quantityMax}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('increase')}
            >
              <PlusIcon size={18} />
            </button>
          </div>
          {errors.quantity ? <p className="mt-1 text-sm font-semibold text-terracotta-600">{errorText('quantity')}</p> : null}
        </div>
        {product ? (
          <p className="text-sm text-earth-700">
            {t('priceLine', { price: formatPrice(product.price, locale) })}
            <span className="block text-xs text-muted">{t('totalNote')}</span>
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-earth-900">{t('buyerTitle')}</legend>
        <Field id={fieldId('buyerName')} label={t('buyerName')} error={errorText('buyerName')}>
          <input
            id={fieldId('buyerName')}
            value={values.buyerName}
            onChange={(e) => update('buyerName', e.target.value)}
            autoComplete="name"
            maxLength={LIMITS.nameMax}
            required
            aria-invalid={Boolean(errors.buyerName)}
            aria-describedby={describedBy('buyerName')}
            className={clsx(inputClass, 'border-earth-200')}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={fieldId('buyerPhone')} label={t('buyerPhone')} error={errorText('buyerPhone')}>
            <input
              id={fieldId('buyerPhone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 7__ ___ __ __"
              value={values.buyerPhone}
              onChange={(e) => update('buyerPhone', e.target.value)}
              maxLength={LIMITS.phoneMax}
              required
              aria-invalid={Boolean(errors.buyerPhone)}
              aria-describedby={describedBy('buyerPhone')}
              className={clsx(inputClass, 'border-earth-200')}
            />
          </Field>
          <Field id={fieldId('buyerEmail')} label={t('buyerEmail')} error={errorText('buyerEmail')} hint={t('buyerEmailHint')}>
            <input
              id={fieldId('buyerEmail')}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={values.buyerEmail}
              onChange={(e) => update('buyerEmail', e.target.value)}
              maxLength={LIMITS.emailMax}
              required
              aria-invalid={Boolean(errors.buyerEmail)}
              aria-describedby={describedBy('buyerEmail', true)}
              className={clsx(inputClass, 'border-earth-200')}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-earth-900">{t('recipientTitle')}</legend>
        <p className="text-sm text-muted">{t('recipientHint')}</p>
        <Field id={fieldId('recipientName')} label={t('recipientName')} error={errorText('recipientName')}>
          <input
            id={fieldId('recipientName')}
            value={values.recipientName}
            onChange={(e) => update('recipientName', e.target.value)}
            autoComplete="off"
            maxLength={LIMITS.nameMax}
            required
            aria-invalid={Boolean(errors.recipientName)}
            aria-describedby={describedBy('recipientName')}
            className={clsx(inputClass, 'border-earth-200')}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={fieldId('recipientEmail')} label={t('recipientEmail')} error={errorText('recipientEmail')} optionalLabel={common('optional')}>
            <input
              id={fieldId('recipientEmail')}
              type="email"
              inputMode="email"
              autoComplete="off"
              value={values.recipientEmail}
              onChange={(e) => update('recipientEmail', e.target.value)}
              maxLength={LIMITS.emailMax}
              aria-invalid={Boolean(errors.recipientEmail)}
              aria-describedby={describedBy('recipientEmail')}
              className={clsx(inputClass, 'border-earth-200')}
            />
          </Field>
          <Field id={fieldId('recipientPhone')} label={t('recipientPhone')} error={errorText('recipientPhone')} optionalLabel={common('optional')}>
            <input
              id={fieldId('recipientPhone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              placeholder="+7 7__ ___ __ __"
              value={values.recipientPhone}
              onChange={(e) => update('recipientPhone', e.target.value)}
              maxLength={LIMITS.phoneMax}
              aria-invalid={Boolean(errors.recipientPhone)}
              aria-describedby={describedBy('recipientPhone')}
              className={clsx(inputClass, 'border-earth-200')}
            />
          </Field>
        </div>
        <Field id={fieldId('message')} label={t('message')} error={errorText('message')} hint={t('messageHint')} optionalLabel={common('optional')}>
          <textarea
            id={fieldId('message')}
            value={values.message}
            onChange={(e) => update('message', e.target.value)}
            maxLength={LIMITS.messageMax}
            rows={3}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={clsx(describedBy('message', true), `${fieldId('message')}-counter`)}
            className={clsx(inputClass, 'h-auto border-earth-200 py-2')}
          />
          <p id={`${fieldId('message')}-counter`} className="mt-1 text-right text-xs text-muted">
            {t('messageCounter', { count: values.message.length, max: LIMITS.messageMax })}
          </p>
        </Field>
      </fieldset>

      <fieldset>
        <legend className="text-lg font-semibold text-earth-900">{t('channelTitle')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {DELIVERY_CHANNELS.map((channel) => (
            <label
              key={channel}
              className={clsx(
                'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-gold-500',
                values.deliveryChannel === channel ? 'border-earth-700 bg-earth-700 text-cream-50' : 'border-earth-200 text-earth-800',
              )}
            >
              <input
                type="radio"
                name={fieldId('deliveryChannel')}
                value={channel}
                checked={values.deliveryChannel === channel}
                onChange={() => update('deliveryChannel', channel)}
                className="sr-only"
              />
              {channel === 'email' ? t('channelEmail') : t('channelWhatsapp')}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3 rounded-card border border-earth-100 bg-cream-50 p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            id={fieldId('consentPersonalData')}
            type="checkbox"
            checked={values.consentPersonalData}
            onChange={(e) => update('consentPersonalData', e.target.checked)}
            required
            aria-invalid={Boolean(errors.consentPersonalData)}
            aria-describedby={clsx(`${id}-consent-text`, describedBy('consentPersonalData'))}
            className="mt-0.5 h-5 w-5 shrink-0 accent-earth-700"
          />
          <span className="text-earth-900">{t('consent')}</span>
        </label>
        {errors.consentPersonalData ? (
          <p id={`${fieldId('consentPersonalData')}-error`} className="text-sm font-semibold text-terracotta-600">
            {errorText('consentPersonalData')}
          </p>
        ) : null}
        <details id={`${id}-consent-text`} className="text-sm">
          <summary className="inline-flex min-h-10 cursor-pointer items-center font-semibold text-earth-700 underline underline-offset-4">
            {t('consentShow')}
          </summary>
          {consent ? (
            <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-line rounded-xl bg-cream-100 p-3 text-earth-800">
              {consent.text}
              <p className="mt-2 text-xs text-muted">{t('consentVersion', { version: formatDate(consent.publishedAt, locale) })}</p>
            </div>
          ) : null}
          <Link href={routes.consent('personal-data')} target="_blank" className="mt-2 inline-flex min-h-10 items-center text-earth-700 underline underline-offset-4">
            {t('consentOpen')}
          </Link>
        </details>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={values.consentMarketing}
            onChange={(e) => update('consentMarketing', e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-earth-700"
          />
          <span className="text-sm text-earth-800">
            {t('consentMarketing')} <span className="text-muted">· {common('optional')}</span>
          </span>
        </label>
      </div>

      {formError ? (
        <p id={`${id}-form-error`} role="alert" className="rounded-2xl border border-terracotta-500/40 bg-terracotta-500/5 p-3 font-semibold text-terracotta-600">
          {formError}
        </p>
      ) : null}

      <button type="submit" disabled={submitting} aria-busy={submitting} className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
