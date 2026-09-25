import clsx from 'clsx';
import type { ReactNode } from 'react';
import { OrnamentDivider } from '@/components/brand/Ornament';

export function PageHeading({
  title,
  subtitle,
  eyebrow,
  className,
  compact = false,
  children,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  className?: string;
  /** Меньший верхний отступ (над заголовком есть «хлебные крошки»). */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <header className={clsx('pb-6', compact ? 'pt-2 sm:pt-4' : 'pt-8 sm:pt-12', className)}>
      {eyebrow ? <p className="text-sm font-semibold uppercase tracking-widest text-gold-700">{eyebrow}</p> : null}
      <h1 className="mt-1 font-display text-3xl font-semibold text-earth-900 sm:text-4xl">{title}</h1>
      {subtitle ? <p className="mt-3 max-w-2xl text-lg text-muted">{subtitle}</p> : null}
      {children}
      <OrnamentDivider className="mt-6 max-w-xs" />
    </header>
  );
}
