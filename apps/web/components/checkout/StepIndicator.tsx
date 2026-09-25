'use client';

import clsx from 'clsx';
import { useTranslations } from 'next-intl';

const STEPS = ['cart', 'details', 'payment', 'status'] as const;
export type FlowStep = (typeof STEPS)[number];

/** Оформление — не больше 4 экранов (ТЗ): корзина → данные → оплата → статус заказа. */
export function StepIndicator({ current }: { current: FlowStep }) {
  const t = useTranslations('Checkout.steps');
  const currentIndex = STEPS.indexOf(current);
  return (
    <ol className="mb-6 grid grid-cols-4 gap-2 text-center text-xs font-semibold sm:text-sm">
      {STEPS.map((step, index) => (
        <li key={step} aria-current={step === current ? 'step' : undefined}>
          <span
            className={clsx(
              'mx-auto mb-1 grid h-8 w-8 place-items-center rounded-full',
              index < currentIndex && 'bg-earth-600 text-cream-50',
              index === currentIndex && 'bg-gold-400 text-earth-900',
              index > currentIndex && 'bg-earth-100 text-earth-500',
            )}
          >
            {index + 1}
          </span>
          <span className={clsx(index === currentIndex ? 'text-earth-900' : 'text-muted')}>{t(step)}</span>
        </li>
      ))}
    </ol>
  );
}
