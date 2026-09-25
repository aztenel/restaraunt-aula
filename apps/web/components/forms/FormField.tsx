'use client';

import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { FieldError } from '@/lib/validation';

/** Поле ввода без внешних отступов. */
export const inputBase =
  'block min-h-12 w-full rounded-xl border border-earth-200 bg-cream-50 px-3 text-base text-earth-900 placeholder:text-earth-400 aria-[invalid=true]:border-terracotta-500 disabled:opacity-60';
/** Поле ввода под подписью FormField. */
export const inputClass = `mt-1 ${inputBase}`;

/** Текст ошибки поля по коду (пространство имён Forms). */
export function useFieldErrorText(): (code: FieldError | undefined) => string | undefined {
  const t = useTranslations('Forms');
  return (code) => (code ? t(`errors.${code}`) : undefined);
}

/** id подсказки/ошибки для aria-describedby. */
export function describedBy(id: string, error: string | undefined, hint: string | undefined): string | undefined {
  if (error) return `${id}-error`;
  if (hint) return `${id}-hint`;
  return undefined;
}

/** Подпись, подсказка и ошибка поля; само поле — children (id совпадает с htmlFor). */
export function FormField({
  id,
  label,
  error,
  hint,
  optional = false,
  className,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('Forms');
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold text-earth-800">
        {label}
        {optional ? <span className="font-normal text-muted"> · {t('optional')}</span> : null}
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

/** Сообщение об ошибке формы (role=alert). */
export function FormError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={clsx('rounded-2xl border border-terracotta-500/40 bg-terracotta-500/5 p-3 font-semibold text-terracotta-600', className)}>
      {children}
    </p>
  );
}
