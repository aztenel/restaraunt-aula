import clsx from 'clsx';
import type { ReactNode } from 'react';

const TONES = {
  info: 'border-earth-200 bg-cream-50 text-earth-800',
  warning: 'border-gold-400 bg-gold-200/40 text-earth-900',
  error: 'border-terracotta-500/50 bg-terracotta-500/5 text-terracotta-600',
  success: 'border-steppe-700/30 bg-steppe-100 text-steppe-700',
} as const;

/** Сообщение в потоке страницы: статус (role=status) или ошибка (role=alert). */
export function Notice({
  tone = 'info',
  title,
  children,
  className,
  live = false,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
  /** Объявить экранному чтецу при появлении. */
  live?: boolean;
}) {
  return (
    <div
      role={live ? (tone === 'error' ? 'alert' : 'status') : undefined}
      className={clsx('rounded-2xl border p-4 text-sm sm:text-base', TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={clsx(title && 'mt-1')}>{children}</div> : null}
    </div>
  );
}
