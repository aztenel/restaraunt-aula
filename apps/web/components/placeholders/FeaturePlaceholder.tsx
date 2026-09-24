import type { ReactNode } from 'react';
import { RamHorn } from '@/components/brand/Ornament';

/**
 * Заглушка раздела, API которого ещё в разработке. Для гостя — понятный текст и контакты,
 * для разработчиков — TODO в файле страницы с ожидаемыми эндпоинтами.
 */
export function FeaturePlaceholder({
  badge,
  title,
  text,
  children,
}: {
  badge: string;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden rounded-card border border-earth-100 bg-cream-50 p-6 shadow-card sm:p-8">
      <RamHorn className="pointer-events-none absolute -right-6 -top-4 h-28 w-48 text-earth-100" strokeWidth={1.5} />
      <span className="relative inline-flex rounded-full bg-gold-200 px-3 py-1 text-xs font-bold uppercase tracking-wider text-gold-700">
        {badge}
      </span>
      <h2 className="relative mt-4 text-2xl font-semibold text-earth-900">{title}</h2>
      <p className="relative mt-2 max-w-2xl text-earth-700">{text}</p>
      {children ? <div className="relative mt-6">{children}</div> : null}
    </section>
  );
}
