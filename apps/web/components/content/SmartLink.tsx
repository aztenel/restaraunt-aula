import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

/**
 * Ссылка из контента (баннер, акция): внутренний путь витрины ('/menu') — через Link с языком,
 * внешний https-адрес — в новой вкладке. Прочие схемы не выводятся.
 */
export function SmartLink({ href, className, children, ariaLabel }: { href: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link href={href} className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} className={className} aria-label={ariaLabel} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  }
  return <span className={className}>{children}</span>;
}

export function isUsableLink(href: string | null | undefined): href is string {
  return !!href && ((href.startsWith('/') && !href.startsWith('//')) || /^https?:\/\//i.test(href));
}
