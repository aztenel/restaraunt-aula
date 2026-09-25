'use client';

import clsx from 'clsx';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { CheckIcon, MinusIcon, PlusIcon } from '@/components/ui/icons';
import { trackStorefrontEvent } from '@/lib/analytics-session';
import type { ModifierGroup } from '@/lib/api-types';
import { MAX_LINE_QUANTITY, useCart } from '@/lib/cart';
import { formatPrice } from '@/lib/format';
import { Goals, reachGoal } from '@/lib/goals';
import {
  clearGroup,
  groupRule,
  initialSelection,
  isGroupRequired,
  isOptionDisabled,
  isOptionSelected,
  selectedOptionIds,
  selectionMode,
  toggleOption,
  unmetGroups,
  type GroupRuleKind,
  type ModifierSelection,
} from '@/lib/modifiers';
import { routes } from '@/lib/routes';

const RULE_KEYS = {
  optionalOne: 'ruleOptionalOne',
  optionalUpTo: 'ruleOptionalUpTo',
  requiredOne: 'ruleRequiredOne',
  requiredExactly: 'ruleRequiredExactly',
  requiredRange: 'ruleRequiredRange',
} as const satisfies Record<GroupRuleKind, string>;

export interface DishOrderPanelProps {
  dishId: string;
  name: string;
  branchId: string;
  available: boolean;
  modifierGroups: ModifierGroup[];
}

/**
 * Заказ со страницы блюда: варианты и добавки по правилам с сервера (min/max/обязательность),
 * количество, «В корзину». Итог с добавками не считается: доплаты опций показаны как есть,
 * сумма — в корзине из POST /public/orders/quote (там же сервер окончательно проверит выбор).
 */
export function DishOrderPanel({ dishId, name, branchId, available, modifierGroups }: DishOrderPanelProps) {
  const t = useTranslations('Dish');
  const locale = useLocale();
  const pathname = usePathname();
  const cart = useCart();
  const baseId = useId();
  const [selection, setSelection] = useState<ModifierSelection>(() => initialSelection(modifierGroups));
  const [quantity, setQuantity] = useState(1);
  const [attempted, setAttempted] = useState(false);
  const [added, setAdded] = useState(false);
  const groupRefs = useRef(new Map<string, HTMLFieldSetElement>());

  const unmet = useMemo(() => unmetGroups(modifierGroups, selection), [modifierGroups, selection]);

  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(false), 4000);
    return () => window.clearTimeout(timer);
  }, [added]);

  const onToggle = (groupId: string, optionId: string) => {
    setSelection((s) => toggleOption(modifierGroups, s, groupId, optionId));
    setAdded(false);
  };

  const onAdd = () => {
    if (!available) return;
    if (unmet.length > 0) {
      setAttempted(true);
      const fieldset = groupRefs.current.get(unmet[0]!);
      fieldset?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      fieldset?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({ preventScroll: true });
      return;
    }
    cart.add({ dishId, branchId, modifierOptionIds: selectedOptionIds(modifierGroups, selection), quantity });
    reachGoal(Goals.AddToCart, { dish_id: dishId, branch_id: branchId, quantity });
    trackStorefrontEvent('add_to_cart', { path: pathname, branchId });
    setAdded(true);
    setAttempted(false);
  };

  return (
    <div className="mt-6">
      {modifierGroups.length > 0 ? (
        <section aria-labelledby={`${baseId}-mods`} className="space-y-4">
          <h2 id={`${baseId}-mods`} className="text-xl font-semibold text-earth-900">
            {t('modifiersTitle')}
          </h2>
          {modifierGroups.map((group) => {
            const rule = groupRule(group);
            const mode = selectionMode(group);
            const required = isGroupRequired(group);
            const invalid = attempted && unmet.includes(group.id);
            const ruleId = `${baseId}-${group.id}-rule`;
            const errorId = `${baseId}-${group.id}-error`;
            const inputName = `${baseId}-${group.id}`;
            return (
              <fieldset
                key={group.id}
                ref={(el) => {
                  if (el) groupRefs.current.set(group.id, el);
                  else groupRefs.current.delete(group.id);
                }}
                aria-describedby={clsx(ruleId, invalid && errorId)}
                aria-invalid={invalid || undefined}
                className={clsx(
                  'rounded-2xl border bg-cream-50 p-4',
                  invalid ? 'border-terracotta-500' : 'border-earth-100',
                )}
              >
                <legend className="float-left w-full">
                  <span className="font-semibold text-earth-900">{group.name}</span>
                  <span id={ruleId} className={clsx('mt-0.5 block text-sm', required ? 'text-gold-700' : 'text-muted')}>
                    {t(RULE_KEYS[rule.kind], { min: rule.min, max: rule.max })}
                  </span>
                </legend>
                {group.description ? <p className="clear-both pt-1 text-sm text-muted">{group.description}</p> : null}
                <ul className="clear-both mt-2 space-y-1">
                  {mode === 'single' && !required ? (
                    <li>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 hover:bg-earth-50">
                        <input
                          type="radio"
                          name={inputName}
                          checked={(selection[group.id] ?? []).length === 0}
                          onChange={() => setSelection((s) => clearGroup(modifierGroups, s, group.id))}
                          className="h-5 w-5 shrink-0 accent-earth-700"
                        />
                        <span className="text-earth-800">{t('noneOption')}</span>
                      </label>
                    </li>
                  ) : null}
                  {group.options.map((option) => {
                    const checked = isOptionSelected(selection, group.id, option.id);
                    const disabled = isOptionDisabled(group, selection, option.id);
                    return (
                      <li key={option.id}>
                        <label
                          className={clsx(
                            'flex min-h-11 items-center gap-3 rounded-xl px-2',
                            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-earth-50',
                          )}
                        >
                          <input
                            type={mode === 'single' ? 'radio' : 'checkbox'}
                            name={inputName}
                            value={option.id}
                            checked={checked}
                            disabled={disabled}
                            onChange={() => onToggle(group.id, option.id)}
                            className="h-5 w-5 shrink-0 accent-earth-700"
                          />
                          <span className="min-w-0 flex-1 text-earth-900">{option.name}</span>
                          {option.price.amount > 0 ? (
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-earth-700">
                              {t('surcharge', { price: formatPrice(option.price, locale) })}
                            </span>
                          ) : null}
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {invalid ? (
                  <p id={errorId} className="mt-2 text-sm font-semibold text-terracotta-600" role="alert">
                    {t('chooseRequired', { group: group.name })}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </section>
      ) : null}

      {available ? (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 -mx-4 mt-6 border-y border-earth-100 bg-cream-100/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1" role="group" aria-label={t('quantity')}>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className={buttonClasses('outline', 'icon')}
                aria-label={t('decrease')}
              >
                <MinusIcon size={18} />
              </button>
              <output className="w-8 text-center text-lg font-semibold tabular-nums" aria-live="polite">
                {quantity}
              </output>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))}
                disabled={quantity >= MAX_LINE_QUANTITY}
                className={buttonClasses('outline', 'icon')}
                aria-label={t('increase')}
              >
                <PlusIcon size={18} />
              </button>
            </div>
            <button type="button" onClick={onAdd} className={buttonClasses(added ? 'secondary' : 'primary', 'md', 'flex-1')}>
              {added ? <CheckIcon size={20} /> : <PlusIcon size={20} />}
              {added ? t('added') : t('add')}
            </button>
          </div>
          <div role="status" aria-live="polite" className="empty:hidden">
            {added ? (
              <p className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-steppe-700">
                <span>{t('addedAnnounce', { name })}</span>
                <Link href={routes.cart()} className="font-semibold text-earth-800 underline underline-offset-4">
                  {t('goToCart')}
                </Link>
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p role="status" className="mt-6 rounded-2xl border border-earth-200 bg-cream-50 p-4 text-earth-800">
          <span className="font-semibold">{t('unavailable')}.</span> {t('unavailableText')}
        </p>
      )}
    </div>
  );
}
