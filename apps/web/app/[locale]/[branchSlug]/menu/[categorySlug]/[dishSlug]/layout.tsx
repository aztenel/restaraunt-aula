import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { permanentRedirect } from '@/i18n/navigation';
import { getDish } from '@/lib/catalog';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';

/**
 * Проверка блюда ВЫШЕ границы Suspense (loading.tsx сегмента): неизвестное блюдо — настоящий
 * HTTP 404. Блюдо из другой категории (устаревшая ссылка) — 308 на канонический адрес.
 */
export default async function DishLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; branchSlug: string; categorySlug: string; dishSlug: string }>;
}) {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug, dishSlug } = await params;
  const dish = await getDish(locale, branchSlug, dishSlug);
  if (!dish) notFound();
  if (dish.categorySlug !== categorySlug || dish.slug !== dishSlug) {
    permanentRedirect({ href: routes.dish(dish.branch.slug, dish.categorySlug, dish.slug), locale });
  }
  return children;
}
