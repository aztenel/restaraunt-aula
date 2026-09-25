'use client';

import clsx from 'clsx';
import Image from 'next/image';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { call } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { DishPhotoPlaceholder } from '@/components/menu/DishPhotoPlaceholder';
import { buttonClasses } from '@/components/ui/button';
import { BagIcon, CartIcon, MinusIcon, PlusIcon, TrashIcon, TruckIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/Skeleton';
import { trackStorefrontEvent } from '@/lib/analytics-session';
import { getBrowserApi } from '@/lib/api';
import { apiErrorKey, problemKey, retryAfterMinutes } from '@/lib/api-errors';
import type { BranchMenu } from '@/lib/api-types';
import { writeBranchCookie } from '@/lib/branch-cookie';
import { MAX_LINE_QUANTITY, useCart, type CartLine } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { Goals, reachGoal } from '@/lib/goals';
import { canProceedToCheckout, CHECKOUT_STEP_PROBLEMS, ORDER_TYPES, type OrderType, type Quote, type QuoteLine } from '@/lib/ordering';
import { routes } from '@/lib/routes';
import { useCartQuote } from './useCartQuote';

/** Филиал для корзины (строки уже переведены на сервере). */
export interface CartBranchOption {
  id: string;
  slug: string;
  name: string;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
}

interface DishLabel {
  name: string;
  photoUrl: string | null;
}

function acceptedTypes(branch: CartBranchOption | undefined): OrderType[] {
  if (!branch) return [...ORDER_TYPES];
  return ORDER_TYPES.filter((type) => (type === 'pickup' ? branch.acceptsPickup : branch.acceptsDelivery));
}

/**
 * Названия блюд, если расчёт недоступен (эндпоинт ещё не развёрнут или сбой): меню филиала
 * (GET /public/catalog/branches/{slug}/menu). Только подписи — без цен и сумм.
 */
function useFallbackLabels(locale: string, branchSlug: string | null, enabled: boolean): Map<string, DishLabel> {
  const [labels, setLabels] = useState<Map<string, DishLabel>>(() => new Map());
  useEffect(() => {
    if (!enabled || !branchSlug) return;
    const controller = new AbortController();
    const api = getBrowserApi(locale);
    call(
      api.GET('/api/v1/public/catalog/branches/{branchSlug}/menu', {
        params: { path: { branchSlug }, query: { locale: locale as 'kk' | 'ru' | 'en' } },
        signal: controller.signal,
      }),
    )
      .then((data) => {
        const menu = data as unknown as BranchMenu;
        const map = new Map<string, DishLabel>();
        for (const category of menu.categories) {
          for (const dish of category.dishes) map.set(dish.id, { name: dish.name, photoUrl: dish.photo?.variants[0]?.url ?? dish.photo?.url ?? null });
        }
        setLabels(map);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [locale, branchSlug, enabled]);
  return labels;
}

/**
 * Корзина: позиции из локального хранилища (id блюд, опций, количества), всё остальное —
 * названия, цены, скидка, доставка, итог, доступность — из POST /api/v1/public/orders/quote.
 * Клиент не считает суммы и не проверяет минимальную сумму заказа.
 */
export function CartView({ branches }: { branches: CartBranchOption[] }) {
  const t = useTranslations('Cart');
  const problems = useTranslations('OrderProblems');
  const errors = useTranslations('ApiErrors');
  const locale = useLocale();
  const cart = useCart();
  const id = useId();

  // До гидратации localStorage недоступен — показываем заглушку, а не «пустую корзину».
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const branch = branches.find((b) => b.id === cart.branchId);
  const types = acceptedTypes(branch);
  const [preferredType, setPreferredType] = useState<OrderType>('pickup');
  const type: OrderType = types.includes(preferredType) ? preferredType : (types[0] ?? 'pickup');

  const [promoInput, setPromoInput] = useState('');
  const [promoCode, setPromoCode] = useState<string | null>(null);

  const api = useMemo(() => getBrowserApi(locale), [locale]);
  const quote = useCartQuote({
    api,
    locale,
    branchId: branch?.id ?? null,
    type,
    lines: cart.lines,
    promoCode,
    enabled: mounted && Boolean(branch),
  });

  const needFallback = quote.status === 'unavailable' || (quote.status === 'error' && !quote.quote);
  const fallbackLabels = useFallbackLabels(locale, branch?.slug ?? null, mounted && needFallback);

  const quoteLines = useMemo(() => {
    const map = new Map<string, QuoteLine>();
    quote.quote?.lines.forEach((line, i) => {
      const key = quote.requestKeys[line.index] ?? quote.requestKeys[i];
      if (key) map.set(key, line);
    });
    return map;
  }, [quote.quote, quote.requestKeys]);

  if (!mounted) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
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
        <Link href={branch ? routes.branchMenu(branch.slug) : routes.menu()} className={buttonClasses('primary', 'md', 'mt-6')}>
          {t('toMenu')}
        </Link>
      </section>
    );
  }

  const chooseBranch = (branchId: string) => {
    const next = branches.find((b) => b.id === branchId);
    if (!next) return;
    writeBranchCookie(next.slug);
    cart.setBranch(next.id);
  };

  const onPromoSubmit = (event: FormEvent) => {
    event.preventDefault();
    const code = promoInput.trim();
    setPromoCode(code ? code.toUpperCase() : null);
  };

  const current: Quote | null = quote.status === 'ok' ? quote.quote : null;
  const lineIssues = cart.lines.some((line) => {
    const q = quoteLines.get(line.key);
    return q ? !q.available || q.problem !== null : false;
  });
  const checkoutAllowed = current ? canProceedToCheckout(current) : quote.status !== 'loading';
  const orderProblems = (current?.problems ?? []).filter(
    (code) => !code.startsWith('promo.') && !code.startsWith('catalog.') && code !== 'order.empty',
  );
  const errorText = (() => {
    if (quote.status !== 'error' || !quote.error) return null;
    const error = quote.error;
    // Нарушение правила заказа (филиал не принимает этот способ и т.п.) — текст из словаря проблем.
    const orderProblem = error.code.startsWith('order.') ? problemKey(error.code, (k) => problems.has(k)) : 'generic';
    if (orderProblem !== 'generic') return problems(orderProblem);
    const key = apiErrorKey(error, (k) => errors.has(k));
    const minutes = retryAfterMinutes(error);
    const base = key === 'generic' || key === 'network_error' ? t('quoteError') : errors(key);
    return minutes ? `${base} ${errors('retryIn', { minutes })}` : base;
  })();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div>
        <ul className="space-y-3" aria-busy={quote.pending}>
          {cart.lines.map((line) => (
            <CartLineItem
              key={line.key}
              line={line}
              quoteLine={quoteLines.get(line.key) ?? null}
              fallback={fallbackLabels.get(line.dishId) ?? null}
              showPrices={quote.status === 'ok'}
              locale={locale}
              onQuantity={(quantity) => cart.setQuantity(line.key, quantity)}
              onRemove={() => cart.remove(line.key)}
            />
          ))}
        </ul>
        {lineIssues ? (
          <p role="alert" className="mt-3 rounded-2xl border border-terracotta-500/40 bg-terracotta-500/5 p-3 text-sm font-semibold text-terracotta-600">
            {t('fixLines')}
          </p>
        ) : null}
      </div>

      <aside aria-labelledby={`${id}-summary`} className="h-fit space-y-5 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card lg:sticky lg:top-20">
        <h2 id={`${id}-summary`} className="text-xl font-semibold text-earth-900">
          {t('summaryTitle')} · <span className="font-sans text-base font-normal text-muted">{t('items', { count: cart.count })}</span>
        </h2>

        <div>
          <label htmlFor={`${id}-branch`} className="mb-1 block text-sm font-semibold text-earth-800">
            {t('branchLabel')}
          </label>
          <select
            id={`${id}-branch`}
            value={branch?.id ?? ''}
            onChange={(e) => chooseBranch(e.target.value)}
            className="h-11 w-full rounded-xl border border-earth-200 bg-cream-50 px-3 text-base"
          >
            {!branch ? (
              <option value="" disabled>
                {t('chooseBranch')}
              </option>
            ) : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {!branch ? (
            <p className="mt-2 text-sm text-earth-700" role="status">
              {cart.branchId ? t('branchUnknown') : t('chooseBranch')}
            </p>
          ) : null}
        </div>

        {branch && types.length > 0 ? (
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-earth-800">{t('typeLabel')}</legend>
            <div className="grid grid-cols-2 gap-1 rounded-full bg-earth-50 p-1">
              {types.map((option) => (
                <label
                  key={option}
                  className={clsx(
                    'flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-gold-500',
                    type === option ? 'bg-earth-700 text-cream-50' : 'text-earth-800',
                    types.length === 1 && 'col-span-2',
                  )}
                >
                  <input
                    type="radio"
                    name={`${id}-type`}
                    value={option}
                    checked={type === option}
                    onChange={() => setPreferredType(option)}
                    className="sr-only"
                  />
                  {option === 'pickup' ? <BagIcon size={16} /> : <TruckIcon size={16} />}
                  {option === 'pickup' ? t('typePickup') : t('typeDelivery')}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        {branch ? (
          <form onSubmit={onPromoSubmit} className="space-y-1">
            <label htmlFor={`${id}-promo`} className="block text-sm font-semibold text-earth-800">
              {t('promoLabel')}
            </label>
            <div className="flex gap-2">
              <input
                id={`${id}-promo`}
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value.slice(0, 32))}
                placeholder={t('promoPlaceholder')}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                className="h-11 min-w-0 flex-1 rounded-xl border border-earth-200 bg-cream-50 px-3 text-base uppercase placeholder:normal-case"
              />
              <button type="submit" className={buttonClasses('outline', 'sm')}>
                {t('promoApply')}
              </button>
            </div>
            {current?.promo ? (
              <div role="status" className={clsx('text-sm', current.promo.applied ? 'text-steppe-700' : 'text-terracotta-600')}>
                {current.promo.applied
                  ? `${t('promoApplied', { code: current.promo.code })}${current.promo.freeDelivery ? ` · ${t('promoFreeDelivery')}` : ''}`
                  : problems(problemKey(current.promo.reason, (k) => problems.has(k)))}
                {promoCode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPromoCode(null);
                      setPromoInput('');
                    }}
                    className="ml-2 font-semibold text-earth-700 underline underline-offset-4"
                  >
                    {t('promoRemove')}
                  </button>
                ) : null}
              </div>
            ) : null}
          </form>
        ) : null}

        <CartTotals quote={current} pending={quote.pending || quote.status === 'loading'} type={type} locale={locale} />

        {quote.status === 'unavailable' ? (
          <p role="status" className="rounded-2xl border border-earth-200 bg-cream-100 p-3 text-sm text-earth-800">
            {t('quoteUnavailable')}
          </p>
        ) : null}
        {errorText ? (
          <div role="alert" className="rounded-2xl border border-terracotta-500/40 bg-terracotta-500/5 p-3 text-sm text-terracotta-600">
            <p>{errorText}</p>
            <button type="button" onClick={quote.retry} className="mt-2 font-semibold text-earth-800 underline underline-offset-4">
              {t('recalculate')}
            </button>
          </div>
        ) : null}
        {orderProblems.length > 0 ? (
          <ul className="space-y-1 text-sm" role="status">
            {orderProblems.map((code) => (
              <li key={code} className={CHECKOUT_STEP_PROBLEMS.has(code) ? 'text-muted' : 'font-semibold text-terracotta-600'}>
                {problems(problemKey(code, (k) => problems.has(k)))}
              </li>
            ))}
          </ul>
        ) : null}

        <div>
          {branch && checkoutAllowed ? (
            <Link
              href={routes.checkout()}
              onClick={() => {
                reachGoal(Goals.BeginCheckout, { items: cart.count, branch_id: branch.id });
                trackStorefrontEvent('checkout_start', { path: routes.checkout(), branchId: branch.id });
              }}
              className={buttonClasses('primary', 'md', 'w-full')}
            >
              {t('checkout')}
            </Link>
          ) : (
            <button type="button" disabled className={buttonClasses('primary', 'md', 'w-full')}>
              {t('checkout')}
            </button>
          )}
          <button type="button" onClick={cart.clear} className={buttonClasses('ghost', 'sm', 'mt-2 w-full')}>
            {t('clear')}
          </button>
          <p className="mt-2 text-center text-xs text-muted">{t('totalsNote')}</p>
        </div>
      </aside>
    </div>
  );
}

function CartLineItem({
  line,
  quoteLine,
  fallback,
  showPrices,
  locale,
  onQuantity,
  onRemove,
}: {
  line: CartLine;
  quoteLine: QuoteLine | null;
  fallback: DishLabel | null;
  showPrices: boolean;
  locale: string;
  onQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Cart');
  const problems = useTranslations('OrderProblems');
  const name = quoteLine?.name ?? fallback?.name ?? t('dishPending');
  const photoUrl = quoteLine?.photoUrl ?? fallback?.photoUrl ?? null;
  const unavailable = quoteLine ? !quoteLine.available || quoteLine.problem !== null : false;
  const modifiers = quoteLine?.modifiers ?? [];
  return (
    <li
      className={clsx(
        'flex gap-3 rounded-2xl border bg-cream-50 p-3 sm:p-4',
        unavailable ? 'border-terracotta-500/50' : 'border-earth-100',
      )}
    >
      <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-cream-200 sm:h-20 sm:w-20">
        {photoUrl ? (
          <Image src={photoUrl} alt="" fill sizes="80px" unoptimized className={clsx('object-cover', unavailable && 'grayscale')} />
        ) : (
          <DishPhotoPlaceholder />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-snug text-earth-900">{name}</p>
          {showPrices && quoteLine?.lineTotal ? (
            <p className="shrink-0 font-bold tabular-nums text-earth-900">{formatPrice(quoteLine.lineTotal, locale)}</p>
          ) : null}
        </div>
        {modifiers.length > 0 ? (
          <p className="mt-0.5 text-sm text-muted">{modifiers.map((m) => m.name).join(', ')}</p>
        ) : line.modifierOptionIds.length > 0 && !quoteLine ? (
          <p className="mt-0.5 text-sm text-muted">{t('modifiersCount', { count: line.modifierOptionIds.length })}</p>
        ) : null}
        {showPrices && quoteLine?.unitPrice && line.quantity > 1 ? (
          <p className="text-xs text-muted">{t('unitPrice', { price: formatPrice(quoteLine.unitPrice, locale) })}</p>
        ) : null}
        {unavailable ? (
          <p className="mt-1 text-sm font-semibold text-terracotta-600">
            {t('lineUnavailable')}: {problems(problemKey(quoteLine?.problem ?? null, (k) => problems.has(k)))}
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="group" aria-label={t('quantityAria', { name })}>
            <button
              type="button"
              onClick={() => onQuantity(line.quantity - 1)}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('decrease')}
            >
              <MinusIcon size={18} />
            </button>
            <output className="w-8 text-center font-semibold tabular-nums" aria-live="polite">
              {line.quantity}
            </output>
            <button
              type="button"
              onClick={() => onQuantity(line.quantity + 1)}
              disabled={line.quantity >= MAX_LINE_QUANTITY}
              className={buttonClasses('outline', 'icon')}
              aria-label={t('increase')}
            >
              <PlusIcon size={18} />
            </button>
          </div>
          <button type="button" onClick={onRemove} className={buttonClasses('ghostDanger', 'icon')} aria-label={t('removeAria', { name })}>
            <TrashIcon size={18} />
          </button>
        </div>
      </div>
    </li>
  );
}

/** Суммы — только из ответа сервера. Пока идёт пересчёт — приглушены и помечены. */
function CartTotals({ quote, pending, type, locale }: { quote: Quote | null; pending: boolean; type: OrderType; locale: string }) {
  const t = useTranslations('Cart');
  if (!quote) {
    return pending ? (
      <div className="space-y-2" aria-busy="true" aria-label={t('calculating')}>
        <Skeleton className="h-5 w-full" />
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-7 w-full" />
      </div>
    ) : null;
  }
  const delivery = quote.delivery;
  const deliveryText =
    type === 'delivery' && delivery && !delivery.pointProvided
      ? t('deliveryFeeLater')
      : quote.deliveryFee.amount === 0
        ? t('deliveryFree')
        : formatPrice(quote.deliveryFee, locale);
  return (
    <div aria-busy={pending} aria-live="polite" className={clsx('transition-opacity', pending && 'opacity-60')}>
      <dl className="space-y-1.5 text-earth-800">
        <div className="flex justify-between gap-3">
          <dt>{t('subtotal')}</dt>
          <dd className="tabular-nums">{formatPrice(quote.subtotal, locale)}</dd>
        </div>
        {quote.discount.amount > 0 ? (
          <div className="flex justify-between gap-3 text-steppe-700">
            <dt>{t('discount')}</dt>
            <dd className="tabular-nums">−{formatPrice(quote.discount, locale)}</dd>
          </div>
        ) : null}
        {type === 'delivery' ? (
          <div className="flex justify-between gap-3">
            <dt>{t('deliveryFee')}</dt>
            <dd className="tabular-nums">{deliveryText}</dd>
          </div>
        ) : null}
        <div className="flex justify-between gap-3 border-t border-earth-100 pt-2 text-lg font-bold text-earth-900">
          <dt>{t('total')}</dt>
          <dd className="tabular-nums">{formatPrice(quote.total, locale)}</dd>
        </div>
      </dl>
      {pending ? <p className="mt-1 text-xs text-muted">{t('calculating')}</p> : null}
      {type === 'delivery' && delivery ? (
        <ul className="mt-3 space-y-1 text-sm text-earth-700">
          {delivery.minOrderAmount ? <li>{t('minOrder', { amount: formatPrice(delivery.minOrderAmount, locale) })}</li> : null}
          {!delivery.minOrderReached && delivery.minOrderShortfall && delivery.minOrderShortfall.amount > 0 ? (
            <li className="font-semibold text-terracotta-600">{t('minOrderShortfall', { amount: formatPrice(delivery.minOrderShortfall, locale) })}</li>
          ) : null}
          {delivery.amountToFreeDelivery && delivery.amountToFreeDelivery.amount > 0 ? (
            <li>{t('toFreeDelivery', { amount: formatPrice(delivery.amountToFreeDelivery, locale) })}</li>
          ) : delivery.freeDeliveryFrom && !delivery.pointProvided ? (
            <li>{t('freeDeliveryFrom', { amount: formatPrice(delivery.freeDeliveryFrom, locale) })}</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}

