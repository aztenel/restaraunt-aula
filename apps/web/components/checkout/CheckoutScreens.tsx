'use client';

import clsx from 'clsx';
import type { FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ConsentFields } from '@/components/forms/ConsentFields';
import { FormField, inputBase, inputClass } from '@/components/forms/FormField';
import { PhoneVerification } from '@/components/forms/PhoneVerification';
import { buttonClasses } from '@/components/ui/button';
import { BagIcon, TruckIcon } from '@/components/ui/icons';
import type { DeliveryZone, OrderSlots, Quote } from '@/lib/api-types';
import { formatCertificateCode } from '@/lib/certificates';
import {
  CHECKOUT_LIMITS,
  type CheckoutAction,
  type CheckoutState,
  type DeliveryAddress,
  type PaymentMethod,
  type PhoneVerificationToken,
} from '@/lib/checkout';
import { formatDateTime, formatPhone, formatPrice } from '@/lib/format';
import type { OrderType } from '@/lib/ordering';
import { routes } from '@/lib/routes';
import { AddressPicker, type ResolutionView } from './AddressPicker';
import { TimePicker } from './TimePicker';

export interface CheckoutBranch {
  id: string;
  slug: string;
  name: string;
  address: string;
  phone: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  paymentMethods: PaymentMethod[];
}

type Dispatch = (action: CheckoutAction) => void;
type Errors = Partial<Record<string, string>>;

const radioCard = (active: boolean) =>
  clsx(
    'flex min-h-12 cursor-pointer items-center gap-2 rounded-2xl border-2 px-4 py-3 font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-500',
    active ? 'border-earth-700 bg-cream-50 text-earth-900' : 'border-earth-100 text-earth-800 hover:border-gold-400',
  );

// ---------------------------------------------------------------- Экран «Данные»

export function DetailsScreen({
  idPrefix,
  state,
  dispatch,
  branch,
  branches,
  acceptedTypes,
  onBranchChange,
  zones,
  resolution,
  onConfirmSwitch,
  slots,
  errors,
  onNext,
}: {
  idPrefix: string;
  state: CheckoutState;
  dispatch: Dispatch;
  branch: CheckoutBranch | null;
  branches: CheckoutBranch[];
  acceptedTypes: OrderType[];
  onBranchChange: (branchId: string) => void;
  zones: DeliveryZone[];
  resolution: ResolutionView;
  onConfirmSwitch: () => void;
  slots: { data: OrderSlots | null; loading: boolean; failed: boolean };
  errors: Errors;
  onNext: () => void;
}) {
  const t = useTranslations('Checkout');
  const id = (field: string) => `${idPrefix}-${field}`;
  const pickupBranches = branches.filter((b) => b.acceptsPickup);
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    onNext();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-8">
      <fieldset aria-describedby={errors.type ? `${id('type')}-error` : undefined}>
        <legend className="text-lg font-semibold text-earth-900">{t('typeTitle')}</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(['pickup', 'delivery'] as const).map((type) => {
            const allowed = acceptedTypes.includes(type);
            return (
              <label key={type} className={clsx(radioCard(state.type === type), !allowed && 'cursor-not-allowed opacity-50')}>
                <input
                  id={type === 'pickup' ? id('type') : undefined}
                  type="radio"
                  name={id('type')}
                  checked={state.type === type}
                  disabled={!allowed}
                  onChange={() => dispatch({ type: 'setOrderType', orderType: type })}
                  className="sr-only"
                />
                {type === 'pickup' ? <BagIcon size={20} /> : <TruckIcon size={20} />}
                {type === 'pickup' ? t('pickup') : t('delivery')}
              </label>
            );
          })}
        </div>
        {errors.type ? (
          <p id={`${id('type')}-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
            {t('typeNotAccepted')}
          </p>
        ) : null}
      </fieldset>

      {state.type === 'pickup' ? (
        <section aria-labelledby={id('pickup-title')}>
          <h2 id={id('pickup-title')} className="text-lg font-semibold text-earth-900">
            {t('pickupTitle')}
          </h2>
          <ul className="mt-2 space-y-2">
            {pickupBranches.map((b) => (
              <li key={b.id}>
                <label className={radioCard(branch?.id === b.id)}>
                  <input type="radio" name={id('branch')} checked={branch?.id === b.id} onChange={() => onBranchChange(b.id)} className="h-5 w-5 shrink-0 accent-earth-700" />
                  <span>
                    <span className="block">{b.name}</span>
                    <span className="block text-sm font-normal text-muted">{b.address}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section aria-labelledby={id('address-title')} className="space-y-4">
          <h2 id={id('address-title')} className="text-lg font-semibold text-earth-900">
            {t('addressTitle')}
          </h2>
          <AddressPicker
            idPrefix={idPrefix}
            address={state.address}
            onChange={(patch: Partial<DeliveryAddress>) => dispatch({ type: 'setAddress', patch })}
            zones={zones}
            resolution={resolution}
            onConfirmSwitch={onConfirmSwitch}
            errors={errors}
          />
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-earth-800">
            <input
              type="checkbox"
              checked={state.contactless}
              onChange={(e) => dispatch({ type: 'setContactless', value: e.target.checked })}
              className="h-5 w-5 accent-earth-700"
            />
            {t('contactless')}
          </label>
        </section>
      )}

      <TimePicker
        idPrefix={idPrefix}
        timeMode={state.timeMode}
        scheduledDate={state.scheduledDate}
        scheduledFor={state.scheduledFor}
        slots={slots.data}
        loading={slots.loading}
        failed={slots.failed}
        onAsap={() => dispatch({ type: 'setAsap' })}
        onDate={(date) => dispatch({ type: 'setScheduledDate', date: date || null })}
        onSlot={(at) => dispatch({ type: 'setScheduledFor', at })}
        error={errors.time}
      />

      <fieldset className="space-y-4">
        <legend className="text-lg font-semibold text-earth-900">{t('contactsTitle')}</legend>
        <FormField id={id('name')} label={t('name')} error={errors.name}>
          <input
            id={id('name')}
            value={state.customer.name}
            onChange={(e) => dispatch({ type: 'setCustomer', patch: { name: e.target.value.slice(0, CHECKOUT_LIMITS.nameMax) } })}
            autoComplete="name"
            required
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? `${id('name')}-error` : undefined}
            className={inputClass}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={id('phone')} label={t('phone')} error={errors.phone} hint={t('phoneHint')}>
            <input
              id={id('phone')}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 7__ ___ __ __"
              value={state.customer.phone}
              onChange={(e) => dispatch({ type: 'setCustomer', patch: { phone: e.target.value.slice(0, 32) } })}
              required
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? `${id('phone')}-error` : `${id('phone')}-hint`}
              className={inputClass}
            />
          </FormField>
          <FormField id={id('email')} label={t('email')} error={errors.email} optional>
            <input
              id={id('email')}
              type="email"
              inputMode="email"
              autoComplete="email"
              value={state.customer.email}
              onChange={(e) => dispatch({ type: 'setCustomer', patch: { email: e.target.value.slice(0, 200) } })}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? `${id('email')}-error` : undefined}
              className={inputClass}
            />
          </FormField>
        </div>
        <FormField id={id('comment')} label={t('comment')} error={errors.comment} optional>
          <textarea
            id={id('comment')}
            value={state.comment}
            onChange={(e) => dispatch({ type: 'setComment', value: e.target.value.slice(0, CHECKOUT_LIMITS.commentMax) })}
            rows={2}
            aria-invalid={Boolean(errors.comment)}
            className={clsx(inputClass, 'py-2')}
          />
        </FormField>
      </fieldset>

      <ConsentFields
        idPrefix={idPrefix}
        personalData={state.consentPersonalData}
        marketing={state.consentMarketing}
        onChange={(patch) => dispatch({ type: 'setConsent', ...patch })}
        error={errors.consentPersonalData}
      />

      <button type="submit" className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
        {t('toPayment')}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------- Экран «Оплата»

export function PaymentScreen({
  idPrefix,
  state,
  dispatch,
  branch,
  quote,
  promoInput,
  onPromoInput,
  certificateInput,
  onCertificateInput,
  needsVerification,
  onVerified,
  errors,
  submitting,
  submitLabel,
  onSubmit,
  onBack,
  problemText,
}: {
  idPrefix: string;
  state: CheckoutState;
  dispatch: Dispatch;
  branch: CheckoutBranch | null;
  quote: Quote | null;
  promoInput: string;
  onPromoInput: (value: string) => void;
  certificateInput: string;
  onCertificateInput: (value: string) => void;
  needsVerification: boolean;
  onVerified: (token: PhoneVerificationToken) => void;
  errors: Errors;
  submitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onBack: () => void;
  problemText: (code: string | null | undefined) => string;
}) {
  const t = useTranslations('Checkout');
  const locale = useLocale();
  const id = (field: string) => `${idPrefix}-${field}`;
  const methods = branch?.paymentMethods ?? [];
  const promo = quote?.promo ?? null;
  const certificate = quote?.certificate ?? null;
  const onFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form onSubmit={onFormSubmit} noValidate className="space-y-8">
      <section aria-labelledby={id('recap')} className="rounded-card border border-earth-100 bg-cream-50 p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <h2 id={id('recap')} className="text-base font-semibold text-earth-900">
            {state.type === 'delivery' ? t('recapDelivery') : t('recapPickup')}
          </h2>
          <button type="button" onClick={onBack} className="font-semibold text-earth-700 underline underline-offset-4">
            {t('edit')}
          </button>
        </div>
        <p className="mt-1 text-earth-800">{state.type === 'delivery' ? state.address.addressText : `${branch?.name ?? ''} · ${branch?.address ?? ''}`}</p>
        <p className="text-earth-800">
          {state.timeMode === 'asap' ? t('time.asap') : state.scheduledFor ? formatDateTime(state.scheduledFor, locale) : ''}
        </p>
        <p className="text-muted">
          {state.customer.name} · {formatPhone(state.customer.phone)}
        </p>
      </section>

      <fieldset aria-describedby={errors.paymentMethod ? `${id('paymentMethod')}-error` : undefined}>
        <legend className="text-lg font-semibold text-earth-900">{t('paymentTitle')}</legend>
        <div className="mt-2 space-y-2">
          {methods.map((method, index) => (
            <label key={method} className={radioCard(state.paymentMethod === method)}>
              <input
                id={index === 0 ? id('paymentMethod') : undefined}
                type="radio"
                name={id('paymentMethod')}
                checked={state.paymentMethod === method}
                onChange={() => dispatch({ type: 'setPaymentMethod', method })}
                className="h-5 w-5 shrink-0 accent-earth-700"
              />
              <span>
                <span className="block">{method === 'online' ? t('payOnline') : t('payOnReceipt')}</span>
                <span className="block text-sm font-normal text-muted">{method === 'online' ? t('payOnlineHint') : t('payOnReceiptHint')}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.paymentMethod ? (
          <p id={`${id('paymentMethod')}-error`} className="mt-2 text-sm font-semibold text-terracotta-600">
            {errors.paymentMethod}
          </p>
        ) : null}
      </fieldset>

      {needsVerification || state.verification ? (
        <div id={id('verification')} className="scroll-mt-24">
          <PhoneVerification phone={state.customer.phone} verified={state.verification} onVerified={onVerified} intro={t('verificationIntro')} />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <FormField id={id('promoCode')} label={t('promo')} error={errors.promoCode} optional>
            <div className="mt-1 flex gap-2">
              <input
                id={id('promoCode')}
                value={promoInput}
                onChange={(e) => onPromoInput(e.target.value.toUpperCase().slice(0, CHECKOUT_LIMITS.codeMax))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className={clsx(inputBase, 'min-w-0 flex-1 uppercase')}
              />
              <button type="button" onClick={() => dispatch({ type: 'applyPromo', code: promoInput })} className={buttonClasses('outline', 'sm', 'min-h-12')}>
                {t('apply')}
              </button>
            </div>
          </FormField>
          {promo && state.promoCode ? (
            <p role="status" className={clsx('mt-1 text-sm', promo.applied ? 'text-steppe-700' : 'text-terracotta-600')}>
              {promo.applied ? t('promoApplied', { code: promo.code }) : problemText(promo.reason)}
              <button
                type="button"
                onClick={() => {
                  onPromoInput('');
                  dispatch({ type: 'applyPromo', code: '' });
                }}
                className="ml-2 font-semibold text-earth-700 underline underline-offset-4"
              >
                {t('remove')}
              </button>
            </p>
          ) : null}
        </div>
        <div>
          <FormField id={id('certificateCode')} label={t('certificate')} error={errors.certificateCode} hint={t('certificateHint')} optional>
            <div className="mt-1 flex gap-2">
              <input
                id={id('certificateCode')}
                value={certificateInput}
                onChange={(e) => onCertificateInput(formatCertificateCode(e.target.value))}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX"
                className={clsx(inputBase, 'min-w-0 flex-1 font-mono uppercase')}
              />
              <button type="button" onClick={() => dispatch({ type: 'applyCertificate', code: certificateInput })} className={buttonClasses('outline', 'sm', 'min-h-12')}>
                {t('apply')}
              </button>
            </div>
          </FormField>
          {certificate && state.certificateCode ? (
            <p role="status" className={clsx('mt-1 text-sm', certificate.applied ? 'text-steppe-700' : 'text-terracotta-600')}>
              {certificate.applied
                ? t('certificateApplied', {
                    code: certificate.maskedCode ?? '',
                    balance: certificate.balance ? formatPrice(certificate.balance, locale) : '—',
                    amount: formatPrice(certificate.amount, locale),
                  })
                : problemText(certificate.reason)}
              <button
                type="button"
                onClick={() => {
                  onCertificateInput('');
                  dispatch({ type: 'applyCertificate', code: '' });
                }}
                className="ml-2 font-semibold text-earth-700 underline underline-offset-4"
              >
                {t('remove')}
              </button>
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <button type="button" onClick={onBack} className={buttonClasses('ghost', 'md')}>
          {t('back')}
        </button>
        <button type="submit" disabled={submitting} aria-busy={submitting} className={buttonClasses('primary', 'lg', 'w-full sm:w-auto')}>
          {submitting ? t('submitting') : submitLabel}
        </button>
      </div>
      <p className="text-xs text-muted">
        {t('offerNote')}{' '}
        <Link href={routes.page('offer')} target="_blank" className="underline underline-offset-4">
          {t('offerLink')}
        </Link>
      </p>
    </form>
  );
}
