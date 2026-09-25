import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getCategoryPage } from '@/lib/catalog';
import { resolveLocale } from '@/lib/page';

/**
 * Проверка категории ВЫШЕ границы Suspense ((list)/loading.tsx): неизвестная категория —
 * настоящий HTTP 404. Страница использует тот же ответ API (React cache).
 */
export default async function CategoryLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; branchSlug: string; categorySlug: string }>;
}) {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug } = await params;
  const page = await getCategoryPage(locale, branchSlug, categorySlug);
  if (!page) notFound();
  return children;
}
