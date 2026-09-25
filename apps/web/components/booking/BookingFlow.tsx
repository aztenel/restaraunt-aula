'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError, type ApiError } from '@aula/api-client';
import { useRouter } from '@/i18n/navigation';
import { ConsentFields } from '@/components/forms/ConsentFields';
import { FormError, FormField, inputClass, useFieldErrorText } from '@/components/forms/FormField';
import { PhoneVerification } from '@/components/forms/PhoneVerification';
import { buttonClasses } from '@/components/ui/button';
import { CalendarIcon } from '@/components/ui/icons';
import { Notice } from '@/components/ui/Notice';
import { Skeleton } from '@/components/ui/Skeleton';
import type { AppLocale } from '@/i18n/routing';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, retryAfterMinutes } from '@/lib/api-errors';
import type { AlternativeTime, Availability, HallMap, VenueSlot } from '@/lib/api-types';
import {
  availabilityQuery,
  BOOKING_LIMITS,
  bookingErrorTarget,
  CONTACT_FIELD_ORDER,
  defaultSearch,
  EMPTY_CONTACT,
  localDate,
  localTime,
  toBookingBody,
  validateBookingContact,
  validateSearch,
  venueTypes,
  type BookingContact,
  type BookingSearch,
  type ContactField,
  type SearchField,
} from '@/lib/booking';
import { readBranchCookie } from '@/lib/branch-cookie';
import type { PhoneVerificationToken } from '@/lib/checkout';
import { formatLocalDate, formatPrice } from '@/lib/format';
import { Goals, reachGoal } from '@/lib/goals';
import { routes } from '@/lib/routes';
import { randomUuid } from '@/lib/uuid';
import { comparablePhone, firstError, hasErrors, type FormErrors } from '@/lib/validation';
import { BookingSearchForm, type BookingBranch } from './BookingSearchForm';
import { HallPlan } from './HallPlan';
import { useSlotTime, VenueResults } from './VenueResults';

type SearchResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ok'; availability: Availability; search: BookingSearch };

type MapState = { status: 'idle' | 'loading' | 'error' } | { status: 'ok'; key: string; map: HallMap };

const slotKey = (s: Pick<BookingSearch, 'branchSlug' | 'date' | 'time' | 'guests'>) => `${s.branchSlug}|${s.date}|${s.time}|${s.guests}`;

/**
 * Онлайн-бронь: поиск → свободные места (и схема зала) → контакты → POST /public/reservations
 * → страница брони. Свободность, депозит и правила — только из ответа API; занятость
 * окончательно проверяется транзакционно при создании (занято — обновляем выдачу).
 */
export function BookingFlow({ branches }: { branches: BookingBranch[] }) {
  const t = useTranslations('Booking');
  const apiErrors = useTranslations('ApiErrors');
  const fieldError = useFieldErrorText();
  const locale = useLocale() as AppLocale;
  const router = useRouter();
  const query = useSearchParams();
  const idPrefix = `booking${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const api = useMemo(() => getBrowserApi(locale), [locale]);

  const [search, setSearch] = useState<BookingSearch | null>(null);
  const [clock, setClock] = useState<{ today: string; now: string } | null>(null);
  const [searchErrors, setSearchErrors] = useState<FormErrors<SearchField>>({});
  const [result, setResult] = useState<SearchResult>({ status: 'idle' });
  const [types, setTypes] = useState<Array<{ code: string; name: string }>>([]);
  const [selected, setSelected] = useState<VenueSlot | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [mapState, setMapState] = useState<MapState>({ status: 'idle' });
  const [step, setStep] = useState<'search' | 'contact'>('search');
  const [contact, setContact] = useState<BookingContact>(EMPTY_CONTACT);
  const [contactErrors, setContactErrors] = useState<FormErrors<ContactField>>({});
  const [serverField, setServerField] = useState<{ field: ContactField; text: string } | null>(null);
  const [verification, setVerification] = useState<PhoneVerificationToken | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  const branch = branches.find((b) => b.slug === search?.branchSlug) ?? null;

  // Начальные значения — только в браузере (сегодняшняя дата и выбранный филиал).
  useEffect(() => {
    const now = new Date();
    const wanted = query.get('branch') ?? readBranchCookie();
    const initial = branches.find((b) => b.slug === wanted) ?? branches[0];
    setClock({ today: localDate(now), now: localTime(now) });
    if (initial) setSearch(defaultSearch(initial.slug, now));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один раз при открытии
  }, []);

  // Типы мест филиала — из карты залов (для фильтра).
  const branchSlug = search?.branchSlug ?? null;
  useEffect(() => {
    if (!branchSlug) return;
    const controller = new AbortController();
    setTypes([]);
    call(api.GET('/api/v1/public/branches/{branchSlug}/halls', { params: { path: { branchSlug }, query: { locale } }, signal: controller.signal }))
      .then((map) => setTypes(venueTypes(map.halls.flatMap((h) => h.venues.filter((v) => v.bookableOnline)))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [api, branchSlug, locale]);

  const errorText = useCallback(
    (error: ApiError): string => {
      const minutes = retryAfterMinutes(error);
      return `${apiErrors(apiErrorKey(error, (k) => apiErrors.has(k)))}${minutes ? ` ${apiErrors('retryIn', { minutes })}` : ''}`;
    },
    [apiErrors],
  );

  const loadMap = useCallback(
    async (s: BookingSearch) => {
      const key = slotKey(s);
      setMapState({ status: 'loading' });
      try {
        const map = await call(
          api.GET('/api/v1/public/branches/{branchSlug}/halls', {
            params: { path: { branchSlug: s.branchSlug }, query: { locale, date: s.date, time: s.time, guests: s.guests } },
          }),
        );
        setMapState({ status: 'ok', key, map });
      } catch {
        setMapState({ status: 'error' });
      }
    },
    [api, locale],
  );

  const runSearch = useCallback(
    async (s: BookingSearch, options: { keepNotice?: boolean } = {}) => {
      if (!clock) return;
      const errors = validateSearch(s, clock.today);
      setSearchErrors(errors);
      if (hasErrors(errors)) {
        const first = firstError(errors, ['branchSlug', 'date', 'time', 'guests'] as const);
        if (first) document.getElementById(`${idPrefix}-${first}`)?.focus();
        return;
      }
      if (!options.keepNotice) setNotice(null);
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setResult({ status: 'loading' });
      try {
        const availability = await call(
          api.GET('/api/v1/public/branches/{branchSlug}/reservation-availability', {
            params: { path: { branchSlug: s.branchSlug }, query: availabilityQuery(s, locale) },
            signal: controller.signal,
          }),
        );
        if (controller.signal.aborted) return;
        setResult({ status: 'ok', availability, search: s });
        setSelected((current) => availability.venues.find((v) => v.venueId === current?.venueId) ?? null);
        if (showMap) void loadMap(s);
        window.setTimeout(() => document.getElementById(`${idPrefix}-results`)?.focus(), 50);
      } catch (e) {
        if (controller.signal.aborted) return;
        setResult({ status: 'error', message: errorText(toApiError(e)) });
      }
    },
    [api, clock, errorText, idPrefix, loadMap, locale, showMap],
  );

  const changeSearch = (patch: Partial<BookingSearch>) => {
    setSearch((s) => (s ? { ...s, ...patch } : s));
    setSearchErrors({});
  };

  const pickAlternative = (alt: AlternativeTime) => {
    if (!search) return;
    const next = { ...search, date: alt.date, time: alt.time };
    setSearch(next);
    void runSearch(next);
  };

  const toggleMap = () => {
    const next = !showMap;
    setShowMap(next);
    if (next && result.status === 'ok' && (mapState.status !== 'ok' || mapState.key !== slotKey(result.search))) void loadMap(result.search);
  };

  const selectFromMap = (venueId: string) => {
    if (result.status !== 'ok') return;
    const venue = result.availability.venues.find((v) => v.venueId === venueId);
    if (venue) setSelected(venue);
  };

  const toContact = () => {
    if (!selected) return;
    setStep('contact');
    window.scrollTo?.({ top: 0 });
    window.setTimeout(() => document.getElementById(`${idPrefix}-name`)?.focus(), 50);
  };

  const changeContact = (patch: Partial<BookingContact>) => {
    setContact((c) => {
      const next = { ...c, ...patch };
      if (patch.phone !== undefined && verification && comparablePhone(patch.phone) !== comparablePhone(verification.phone)) setVerification(null);
      return next;
    });
    setContactErrors((errors) => {
      const next = { ...errors };
      for (const key of Object.keys(patch)) delete next[key as ContactField];
      return next;
    });
    if (serverField && Object.keys(patch).includes(serverField.field)) setServerField(null);
    idempotencyKey.current = null;
  };

  const focusField = (field: string) => {
    window.setTimeout(() => {
      const el = document.getElementById(`${idPrefix}-${field}`);
      el?.focus();
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 50);
  };

  const submit = async () => {
    if (submitting || !selected || !branch || result.status !== 'ok') return;
    const errors = validateBookingContact(contact);
    setContactErrors(errors);
    setServerField(null);
    if (hasErrors(errors)) {
      setFormError(t('errorSummary'));
      const first = firstError(errors, CONTACT_FIELD_ORDER);
      if (first) focusField(first);
      return;
    }
    setFormError(null);
    idempotencyKey.current ??= randomUuid();
    setSubmitting(true);
    try {
      const reservation = await call(
        api.POST('/api/v1/public/reservations', {
          body: toBookingBody({
            branchId: branch.id,
            venue: selected,
            search: result.search,
            contact,
            locale,
            idempotencyKey: idempotencyKey.current,
            phoneVerificationToken: verification?.token ?? null,
          }),
        }),
      );
      reachGoal(Goals.ReservationCreated, {
        branch_id: branch.id,
        venue_type: selected.typeCode,
        guests: result.search.guests,
        deposit: Boolean(selected.deposit),
      });
      router.push({ pathname: routes.bookingStatus(reservation.token), query: reservation.status === 'awaiting_deposit' ? { pay: '1' } : {} });
    } catch (e) {
      const error = toApiError(e);
      if (!error.isNetworkError) idempotencyKey.current = null;
      setSubmitting(false);
      const target = bookingErrorTarget(error);
      if (target.needsVerification) {
        setNeedsVerification(true);
        setVerification(null);
        setFormError(t('verificationRequired'));
        return;
      }
      const text = errorText(error);
      if (target.refresh) {
        setStep('search');
        setSelected(null);
        setNotice(`${text} ${t('chooseAnother')}`);
        void runSearch(result.search, { keepNotice: true });
        return;
      }
      setFormError(text);
      if (target.field) {
        setServerField({ field: target.field, text });
        focusField(target.field);
      }
    }
  };

  if (branches.length === 0) return null;
  if (!search || !clock) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const contactError = (field: ContactField) => (serverField?.field === field ? serverField.text : fieldError(contactErrors[field]));
  const selectable = new Set(result.status === 'ok' ? result.availability.venues.map((v) => v.venueId) : []);

  if (step === 'contact' && selected && result.status === 'ok' && branch) {
    return (
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="space-y-4"
          aria-labelledby={`${idPrefix}-contact-title`}
        >
          <h2 id={`${idPrefix}-contact-title`} className="text-xl font-semibold text-earth-900">
            {t('contactTitle')}
          </h2>
          <FormField id={`${idPrefix}-name`} label={t('name')} error={contactError('name')}>
            <input
              id={`${idPrefix}-name`}
              value={contact.name}
              onChange={(e) => changeContact({ name: e.target.value.slice(0, BOOKING_LIMITS.nameMax) })}
              autoComplete="name"
              required
              aria-invalid={Boolean(contactError('name'))}
              className={inputClass}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${idPrefix}-phone`} label={t('phone')} error={contactError('phone')} hint={t('phoneHint')}>
              <input
                id={`${idPrefix}-phone`}
                type="tel"
                inputMode="tel"
                value={contact.phone}
                onChange={(e) => changeContact({ phone: e.target.value.slice(0, 32) })}
                autoComplete="tel"
                placeholder="+7 7__ ___ __ __"
                required
                aria-invalid={Boolean(contactError('phone'))}
                aria-describedby={contactError('phone') ? `${idPrefix}-phone-error` : `${idPrefix}-phone-hint`}
                className={inputClass}
              />
            </FormField>
            <FormField id={`${idPrefix}-email`} label={t('email')} error={contactError('email')} optional>
              <input
                id={`${idPrefix}-email`}
                type="email"
                inputMode="email"
                value={contact.email}
                onChange={(e) => changeContact({ email: e.target.value.slice(0, 200) })}
                autoComplete="email"
                aria-invalid={Boolean(contactError('email'))}
                className={inputClass}
              />
            </FormField>
          </div>
          <FormField id={`${idPrefix}-occasion`} label={t('occasion')} error={contactError('occasion')} optional>
            <input
              id={`${idPrefix}-occasion`}
              value={contact.occasion}
              onChange={(e) => changeContact({ occasion: e.target.value.slice(0, BOOKING_LIMITS.occasionMax) })}
              placeholder={t('occasionPlaceholder')}
              aria-invalid={Boolean(contactError('occasion'))}
              className={inputClass}
            />
          </FormField>
          <FormField id={`${idPrefix}-comment`} label={t('comment')} error={contactError('comment')} optional>
            <textarea
              id={`${idPrefix}-comment`}
              value={contact.comment}
              onChange={(e) => changeContact({ comment: e.target.value.slice(0, BOOKING_LIMITS.commentMax) })}
              rows={3}
              aria-invalid={Boolean(contactError('comment'))}
              className={`${inputClass} py-2`}
            />
          </FormField>
          <ConsentFields
            idPrefix={idPrefix}
            personalData={contact.consentPersonalData}
            marketing={contact.consentMarketing}
            onChange={(patch) =>
              changeContact({
                ...(patch.personalData !== undefined ? { consentPersonalData: patch.personalData } : {}),
                ...(patch.marketing !== undefined ? { consentMarketing: patch.marketing } : {}),
              })
            }
            error={contactError('consentPersonalData')}
          />
          {needsVerification ? (
            <PhoneVerification
              phone={contact.phone}
              verified={verification}
              onVerified={(token) => {
                setVerification(token);
                setFormError(null);
              }}
              intro={t('verificationIntro')}
            />
          ) : null}
          {formError ? <FormError>{formError}</FormError> : null}
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
            <button type="button" onClick={() => setStep('search')} className={buttonClasses('ghost', 'md')}>
              {t('back')}
            </button>
            <button type="submit" disabled={submitting || (needsVerification && !verification)} className={buttonClasses('primary', 'lg')}>
              {submitting ? t('submitting') : selected.deposit ? t('submitDeposit', { amount: formatPrice(selected.deposit, locale) }) : t('submit')}
            </button>
          </div>
          {selected.deposit ? <p className="text-sm text-muted">{t('depositNote', { hours: selected.rules.cancellationDeadlineHours, minutes: selected.rules.holdMinutes })}</p> : null}
        </form>
        <SelectionSummary branch={branch} venue={selected} search={result.search} onEdit={() => setStep('search')} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <div>
        <BookingSearchForm
          idPrefix={idPrefix}
          branches={branches}
          search={search}
          today={clock.today}
          nowTime={clock.now}
          types={types}
          errors={searchErrors}
          loading={result.status === 'loading'}
          onChange={changeSearch}
          onSubmit={() => void runSearch(search)}
        />
      </div>
      <section id={`${idPrefix}-results`} tabIndex={-1} aria-live="polite" aria-busy={result.status === 'loading'} className="space-y-4 focus:outline-none">
        {notice ? <Notice tone="warning">{notice}</Notice> : null}
        {result.status === 'idle' ? (
          <div className="rounded-card border border-dashed border-earth-200 p-6 text-center text-earth-700">
            <CalendarIcon size={28} className="mx-auto text-earth-400" />
            <p className="mt-2">{t('idleText')}</p>
          </div>
        ) : null}
        {result.status === 'loading' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-36 w-full" />
            <Skeleton className="h-36 w-full" />
          </div>
        ) : null}
        {result.status === 'error' ? (
          <Notice tone="error" live>
            {result.message}{' '}
            <button type="button" onClick={() => void runSearch(search)} className="font-semibold underline underline-offset-4">
              {t('retry')}
            </button>
          </Notice>
        ) : null}
        {result.status === 'ok' ? (
          <>
            <p className="text-sm text-muted">
              {t('resultsFor', {
                date: formatLocalDate(result.search.date, locale),
                time: result.search.time,
                guests: result.search.guests,
              })}
            </p>
            <VenueResults availability={result.availability} selectedId={selected?.venueId ?? null} onSelect={setSelected} onAlternative={pickAlternative} />
            {result.availability.venues.length > 0 ? (
              <div>
                <button type="button" onClick={toggleMap} aria-expanded={showMap} className={buttonClasses('outline', 'sm')}>
                  {showMap ? t('map.hide') : t('map.show')}
                </button>
                {showMap ? (
                  <div className="mt-3 space-y-3">
                    {mapState.status === 'loading' ? <Skeleton className="h-64 w-full" /> : null}
                    {mapState.status === 'error' ? <Notice tone="warning">{t('map.error')}</Notice> : null}
                    {mapState.status === 'ok'
                      ? mapState.map.halls
                          .filter((hall) => hall.venues.length > 0)
                          .map((hall) => <HallPlan key={hall.id} hall={hall} selectable={selectable} selectedId={selected?.venueId ?? null} onSelect={selectFromMap} />)
                      : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {selected ? (
              <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold-400 bg-cream-50 p-3 shadow-card md:bottom-4">
                <p className="text-sm text-earth-900">
                  <span className="font-semibold">{selected.name}</span>
                  {selected.deposit ? ` · ${t('deposit', { amount: formatPrice(selected.deposit, locale) })}` : ''}
                </p>
                <button type="button" onClick={toContact} className={buttonClasses('primary', 'md')}>
                  {t('continue')}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function SelectionSummary({ branch, venue, search, onEdit }: { branch: BookingBranch; venue: VenueSlot; search: BookingSearch; onEdit: () => void }) {
  const t = useTranslations('Booking');
  const locale = useLocale();
  const slotTime = useSlotTime();
  return (
    <aside className="h-fit space-y-3 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card lg:sticky lg:top-24" aria-labelledby="booking-summary">
      <div className="flex items-center justify-between gap-2">
        <h2 id="booking-summary" className="text-lg font-semibold text-earth-900">
          {t('summaryTitle')}
        </h2>
        <button type="button" onClick={onEdit} className="text-sm font-semibold text-earth-700 underline underline-offset-4">
          {t('edit')}
        </button>
      </div>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-muted">{t('branch')}</dt>
          <dd className="text-earth-900">
            {branch.name}
            <span className="block text-xs text-muted">{branch.address}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('venue')}</dt>
          <dd className="text-earth-900">
            {venue.name} · {venue.typeName}
            <span className="block text-xs text-muted">{venue.hallName}</span>
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('when')}</dt>
          <dd className="text-earth-900">
            {formatLocalDate(search.date, locale)}, {slotTime(venue.start)}–{slotTime(venue.end)}
          </dd>
        </div>
        <div>
          <dt className="text-muted">{t('guests')}</dt>
          <dd className="text-earth-900">{search.guests}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('depositLabel')}</dt>
          <dd className="font-semibold text-earth-900">{venue.deposit ? formatPrice(venue.deposit, locale) : t('noDeposit')}</dd>
        </div>
      </dl>
      {venue.rules.requiresManualConfirmation ? <p className="text-xs text-muted">{t('manualConfirmation')}</p> : null}
    </aside>
  );
}
