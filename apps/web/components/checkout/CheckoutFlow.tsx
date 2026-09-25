'use client';

import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { call, toApiError, type ApiError } from '@aula/api-client';
import { Link, useRouter } from '@/i18n/navigation';
import { useCartQuote } from '@/components/cart/useCartQuote';
import { FormError, useFieldErrorText } from '@/components/forms/FormField';
import { buttonClasses } from '@/components/ui/button';
import { CartIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { getAnalyticsSessionId } from '@/lib/analytics-session';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, problemKey, retryAfterMinutes } from '@/lib/api-errors';
import type { DeliveryZone, OrderSlots } from '@/lib/api-types';
import { writeBranchCookie } from '@/lib/branch-cookie';
import { toQuoteLines, useCart } from '@/lib/cart';
import {
  advance,
  CHECKOUT_DRAFT_KEY,
  checkoutErrorTarget,
  checkoutReducer,
  deliveryDecision,
  DETAILS_FIELD_ORDER,
  initialCheckoutState,
  parseDraft,
  PAYMENT_FIELD_ORDER,
  pointKey,
  toCheckoutBody,
  toDraft,
  validateDetails,
  validatePayment,
  type CheckoutContext,
  type DetailsField,
  type PaymentField,
} from '@/lib/checkout';
import { formatPrice } from '@/lib/format';
import { ORDER_TYPES, type OrderType } from '@/lib/ordering';
import { routes } from '@/lib/routes';
import { randomUuid } from '@/lib/uuid';
import { firstError, hasErrors, isPhoneLike, type FieldError, type FormErrors } from '@/lib/validation';
import type { ResolutionView } from './AddressPicker';
import { DetailsScreen, PaymentScreen, type CheckoutBranch } from './CheckoutScreens';
import { QuoteSummary } from './QuoteSummary';
import { StepIndicator } from './StepIndicator';

function readDraft() {
  try {
    return parseDraft(window.sessionStorage.getItem(CHECKOUT_DRAFT_KEY));
  } catch {
    return null;
  }
}

/**
 * Оформление заказа: экраны «Данные» и «Оплата» (шаг — в адресе ?step=payment, работает «Назад»
 * браузера), расчёт сервера на каждом шаге, SMS-подтверждение для оплаты при получении (если его
 * требует филиал — сервер отвечает phone.not_verified), POST /public/orders с ключом идемпотентности
 * → страница статуса заказа. Корзина очищается после успешного оформления.
 */
export function CheckoutFlow({ branches }: { branches: CheckoutBranch[] }) {
  const t = useTranslations('Checkout');
  const problems = useTranslations('OrderProblems');
  const apiErrors = useTranslations('ApiErrors');
  const fieldError = useFieldErrorText();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const cart = useCart();
  const idPrefix = useId();
  const api = useMemo(() => getBrowserApi(locale), [locale]);

  const [mounted, setMounted] = useState(false);
  const [state, dispatch] = useReducer(checkoutReducer, undefined, () => initialCheckoutState('pickup'));
  const [detailsErrors, setDetailsErrors] = useState<FormErrors<DetailsField>>({});
  const [paymentErrors, setPaymentErrors] = useState<FormErrors<PaymentField>>({});
  const [serverField, setServerField] = useState<{ field: string; text: string } | null>(null);
  const [formError, setFormError] = useState<{ text: string; cart: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [certificateInput, setCertificateInput] = useState('');
  const idempotencyKey = useRef<string | null>(null);
  const submittedRef = useRef(false);

  // Черновик формы: восстановить после перезагрузки вкладки и сохранять изменения.
  useEffect(() => {
    const draft = readDraft();
    if (draft) dispatch({ type: 'restore', draft });
    setMounted(true);
  }, []);
  useEffect(() => {
    if (!mounted || submittedRef.current) return;
    try {
      window.sessionStorage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(toDraft(state)));
    } catch {
      // Хранилище недоступно — черновик не сохраняется.
    }
    // Изменились данные — новая попытка оформления (новый ключ идемпотентности).
    idempotencyKey.current = null;
  }, [mounted, state]);

  const branch = branches.find((b) => b.id === cart.branchId) ?? null;
  const acceptedTypes: OrderType[] = useMemo(
    () => (branch ? ORDER_TYPES.filter((type) => (type === 'pickup' ? branch.acceptsPickup : branch.acceptsDelivery)) : []),
    [branch],
  );

  // Способ получения, недоступный в филиале, — на первый доступный.
  useEffect(() => {
    if (mounted && acceptedTypes.length > 0 && !acceptedTypes.includes(state.type)) dispatch({ type: 'setOrderType', orderType: acceptedTypes[0]! });
  }, [mounted, acceptedTypes, state.type]);

  // Шаг — из адреса (?step=payment), чтобы «Назад» в браузере возвращал на «Данные».
  const urlStep = searchParams.get('step') === 'payment' ? 'payment' : 'details';
  useEffect(() => {
    dispatch({ type: 'goTo', step: urlStep });
  }, [urlStep]);

  // Зоны доставки всех филиалов с доставкой — подсветка на карте.
  const [zones, setZones] = useState<DeliveryZone[]>([]);
  const zonesLoaded = useRef(false);
  useEffect(() => {
    if (state.type !== 'delivery' || zonesLoaded.current) return;
    zonesLoaded.current = true;
    const deliveryBranches = branches.filter((b) => b.acceptsDelivery);
    void Promise.all(
      deliveryBranches.map((b) =>
        call(api.GET('/api/v1/public/branches/{branchId}/delivery-zones', { params: { path: { branchId: b.id }, query: { locale } } })).catch(() => []),
      ),
    ).then((lists) => setZones(lists.flat()));
  }, [state.type, branches, api, locale]);

  // Точка доставки → филиал и зона (сервер: POST /public/delivery/resolve).
  const key = state.type === 'delivery' ? pointKey(state.address.point, branch?.id ?? null) : null;
  const [resolution, setResolution] = useState<{ key: string | null; view: ResolutionView }>({ key: null, view: { status: 'idle' } });
  useEffect(() => {
    const point = state.address.point;
    if (!key || !point) {
      setResolution({ key: null, view: { status: 'idle' } });
      return;
    }
    const controller = new AbortController();
    setResolution({ key, view: { status: 'loading' } });
    const timer = window.setTimeout(() => {
      call(
        api.POST('/api/v1/public/delivery/resolve', {
          body: { point, address: state.address.addressText.trim() || null },
          params: { query: { locale } },
          signal: controller.signal,
        }),
      )
        .then((result) => {
          if (!controller.signal.aborted) setResolution({ key, view: deliveryDecision(result, branch?.id ?? null) });
        })
        .catch(() => {
          if (!controller.signal.aborted) setResolution({ key, view: { status: 'error' } });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // Текст адреса — только подпись; проверка — по точке и филиалу.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, locale, api]);
  const view = resolution.key === key ? resolution.view : ({ status: key ? 'loading' : 'idle' } as ResolutionView);
  const deliverable = state.type !== 'delivery' ? true : view.status === 'deliverable' ? true : view.status === 'not_deliverable' || view.status === 'switch' ? false : null;

  const confirmSwitch = () => {
    if (view.status !== 'switch') return;
    const next = branches.find((b) => b.id === view.option.branch.id);
    writeBranchCookie(next?.slug ?? view.option.branch.slug);
    cart.setBranch(view.option.branch.id);
  };
  const changeBranch = (branchId: string) => {
    const next = branches.find((b) => b.id === branchId);
    if (!next) return;
    writeBranchCookie(next.slug);
    cart.setBranch(next.id);
  };

  // Время: «как можно скорее» и слоты филиала.
  const [slots, setSlots] = useState<{ key: string | null; data: OrderSlots | null; loading: boolean; failed: boolean }>({ key: null, data: null, loading: false, failed: false });
  const slotsKey = branch ? `${branch.id}|${state.type}|${state.scheduledDate ?? ''}` : null;
  useEffect(() => {
    if (!mounted || !branch || !slotsKey) return;
    const controller = new AbortController();
    setSlots((s) => ({ ...s, key: slotsKey, loading: true, failed: false }));
    call(
      api.GET('/api/v1/public/branches/{branchId}/order-slots', {
        params: { path: { branchId: branch.id }, query: { type: state.type, ...(state.scheduledDate ? { date: state.scheduledDate } : {}), locale } },
        signal: controller.signal,
      }),
    )
      .then((data) => {
        if (!controller.signal.aborted) setSlots({ key: slotsKey, data, loading: false, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSlots({ key: slotsKey, data: null, loading: false, failed: true });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, slotsKey, api, locale]);
  const asapAvailable = slots.data && slots.key === slotsKey ? slots.data.asap.available : null;
  // «Как можно скорее» недоступно (закрыто / скоро закрытие) — сразу предлагаем выбрать время.
  useEffect(() => {
    if (asapAvailable === false && state.timeMode === 'asap' && slots.data) {
      dispatch({ type: 'setScheduledDate', date: slots.data.date || slots.data.dates[0] || null });
    }
  }, [asapAvailable, state.timeMode, slots.data]);

  // Расчёт сервера на каждом шаге.
  const quote = useCartQuote({
    api,
    locale,
    branchId: branch?.id ?? null,
    type: state.type,
    lines: cart.lines,
    promoCode: state.promoCode || null,
    certificateCode: state.certificateCode || null,
    deliveryPoint: deliverable ? state.address.point : null,
    phone: isPhoneLike(state.customer.phone) ? state.customer.phone.trim() : null,
    enabled: mounted && Boolean(branch),
  });
  const currentQuote = quote.status === 'ok' ? quote.quote : null;

  const ctx: CheckoutContext = { acceptedTypes, deliverable, paymentMethods: branch?.paymentMethods ?? [], asapAvailable };

  // Перезагрузка на «Оплате» с незаполненными «Данными» — вернуться на первый экран.
  const checkedReload = useRef(false);
  useEffect(() => {
    if (!mounted || checkedReload.current || urlStep !== 'payment') return;
    if (state.type === 'delivery' && deliverable === null) return;
    checkedReload.current = true;
    if (hasErrors(validateDetails(state, ctx))) router.replace(routes.checkout());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, urlStep, deliverable]);

  const problemText = (code: string | null | undefined) => problems(problemKey(code, (k) => problems.has(k)));
  const errorMessage = (error: ApiError): string => {
    const pk = problemKey(error.code, (k) => problems.has(k));
    if (pk !== 'generic') return problems(pk);
    const key = apiErrorKey(error, (k) => apiErrors.has(k));
    const minutes = retryAfterMinutes(error);
    return `${apiErrors(key)}${minutes ? ` ${apiErrors('retryIn', { minutes })}` : ''}`;
  };

  const focusField = (field: string) => {
    window.setTimeout(() => {
      const el = document.getElementById(`${idPrefix}-${field}`);
      el?.focus();
      el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }, 50);
  };

  const goNext = () => {
    setServerField(null);
    const { state: next, errors } = advance(state, ctx);
    setDetailsErrors(errors);
    if (hasErrors(errors)) {
      setFormError({ text: t('errorSummary'), cart: false });
      const first = firstError(errors, DETAILS_FIELD_ORDER);
      if (first) focusField(first);
      return;
    }
    setFormError(null);
    if (next.paymentMethod !== state.paymentMethod) dispatch({ type: 'setPaymentMethod', method: next.paymentMethod });
    router.push({ pathname: routes.checkout(), query: { step: 'payment' } });
    window.scrollTo?.({ top: 0 });
  };

  const goBack = () => {
    setFormError(null);
    router.push(routes.checkout());
  };

  const submit = async () => {
    if (submitting || !branch) return;
    setServerField(null);
    const dErrors = validateDetails(state, ctx);
    if (hasErrors(dErrors)) {
      setDetailsErrors(dErrors);
      setFormError({ text: t('errorSummary'), cart: false });
      router.push(routes.checkout());
      return;
    }
    const pErrors = validatePayment(state, ctx);
    setPaymentErrors(pErrors);
    if (hasErrors(pErrors)) {
      setFormError({ text: t('errorSummary'), cart: false });
      const first = firstError(pErrors, PAYMENT_FIELD_ORDER);
      if (first) focusField(first);
      return;
    }
    if (currentQuote && currentQuote.problems.length > 0) {
      const blocking = currentQuote.problems[0]!;
      setFormError({ text: problemText(blocking), cart: blocking.startsWith('catalog.') });
      return;
    }
    setFormError(null);
    idempotencyKey.current ??= randomUuid();
    setSubmitting(true);
    try {
      const result = await call(
        api.POST('/api/v1/public/orders', {
          body: toCheckoutBody(state, {
            branchId: branch.id,
            items: toQuoteLines(cart.state),
            locale,
            idempotencyKey: idempotencyKey.current,
            analyticsSessionId: getAnalyticsSessionId(),
          }),
        }),
      );
      submittedRef.current = true;
      try {
        window.sessionStorage.removeItem(CHECKOUT_DRAFT_KEY);
      } catch {
        // no-op
      }
      cart.clear();
      const online = state.paymentMethod === 'online' && result.payment !== null && result.payment !== undefined;
      router.replace({ pathname: routes.order(result.publicToken), query: online ? { pay: '1' } : {} });
    } catch (e) {
      const error = toApiError(e);
      if (!error.isNetworkError) idempotencyKey.current = null;
      setSubmitting(false);
      const target = checkoutErrorTarget(error);
      const text = errorMessage(error);
      if (target.needsVerification) {
        setNeedsVerification(true);
        setFormError({ text: t('verificationRequired'), cart: false });
        return;
      }
      setFormError({ text, cart: target.cart });
      if (target.field) {
        setServerField({ field: target.field, text });
        if (target.step === 'details') router.push(routes.checkout());
        focusField(target.field);
      }
    }
  };

  const stringErrors = (errors: Partial<Record<string, FieldError>>): Partial<Record<string, string>> => {
    const out: Partial<Record<string, string>> = {};
    for (const [field, code] of Object.entries(errors)) out[field] = fieldError(code);
    // Поля, у которых общая подпись ошибки неточна.
    if (errors.point) out.point = errors.point === 'invalid' ? t('address.notDeliverable') : t('address.pointRequired');
    if (errors.time) out.time = errors.time === 'invalid' ? t('time.asapUnavailable') : t('time.chooseSlot');
    if (serverField) out[serverField.field] = serverField.text;
    return out;
  };

  if (!mounted) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <section className="rounded-card border border-earth-100 bg-cream-50 p-8 text-center shadow-card">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gold-200 text-earth-800">
          <CartIcon size={28} />
        </span>
        <h2 className="mt-4 text-2xl font-semibold text-earth-900">{t('emptyTitle')}</h2>
        <p className="mx-auto mt-2 max-w-md text-muted">{t('emptyText')}</p>
        <Link href={routes.menu()} className={buttonClasses('primary', 'md', 'mt-6')}>
          {t('toMenu')}
        </Link>
      </section>
    );
  }

  if (!branch) {
    return (
      <section className="rounded-card border border-earth-100 bg-cream-50 p-6">
        <p className="font-semibold text-earth-900">{t('chooseBranch')}</p>
        <Link href={routes.cart()} className={buttonClasses('primary', 'md', 'mt-4')}>
          {t('toCart')}
        </Link>
      </section>
    );
  }

  const amount = currentQuote ? formatPrice(currentQuote.amountDue, locale) : null;
  const baseLabel = state.paymentMethod === 'online' ? t('submitOnline') : t('submitOnReceipt');
  const submitLabel = amount ? `${baseLabel} · ${amount}` : baseLabel;

  return (
    <>
      <StepIndicator current={state.step} />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div>
          {formError ? (
            <FormError className="mb-6">
              {formError.text}{' '}
              {formError.cart ? (
                <Link href={routes.cart()} className="underline underline-offset-4">
                  {t('toCart')}
                </Link>
              ) : null}
            </FormError>
          ) : null}
          {state.step === 'details' ? (
            <DetailsScreen
              idPrefix={idPrefix}
              state={state}
              dispatch={dispatch}
              branch={branch}
              branches={branches}
              acceptedTypes={acceptedTypes}
              onBranchChange={changeBranch}
              zones={zones}
              resolution={view}
              onConfirmSwitch={confirmSwitch}
              slots={slots}
              errors={stringErrors(detailsErrors)}
              onNext={goNext}
            />
          ) : (
            <PaymentScreen
              idPrefix={idPrefix}
              state={state}
              dispatch={dispatch}
              branch={branch}
              quote={currentQuote}
              promoInput={promoInput}
              onPromoInput={setPromoInput}
              certificateInput={certificateInput}
              onCertificateInput={setCertificateInput}
              needsVerification={needsVerification}
              onVerified={(verification) => {
                dispatch({ type: 'setVerification', verification });
                setFormError(null);
              }}
              errors={stringErrors(paymentErrors)}
              submitting={submitting}
              submitLabel={submitLabel}
              onSubmit={() => void submit()}
              onBack={goBack}
              problemText={problemText}
            />
          )}
        </div>
        <aside aria-labelledby={`${idPrefix}-summary`} className="h-fit rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card lg:sticky lg:top-20">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={`${idPrefix}-summary`} className="text-xl font-semibold text-earth-900">
              {t('summaryTitle')}
            </h2>
            <Link href={routes.cart()} className="text-sm font-semibold text-earth-700 underline underline-offset-4">
              {t('editCart')}
            </Link>
          </div>
          <p className="mb-3 text-sm text-muted">{branch.name}</p>
          <QuoteSummary quote={currentQuote} pending={quote.pending || quote.status === 'loading'} type={state.type} />
          {quote.status === 'error' && quote.error ? <p className="mt-2 text-sm text-terracotta-600">{errorMessage(quote.error)}</p> : null}
          {currentQuote && currentQuote.problems.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm" role="status">
              {currentQuote.problems.map((code) => (
                <li key={code} className={code === 'order.address_required' ? 'text-muted' : 'font-semibold text-terracotta-600'}>
                  {problemText(code)}
                </li>
              ))}
            </ul>
          ) : null}
        </aside>
      </div>
    </>
  );
}
