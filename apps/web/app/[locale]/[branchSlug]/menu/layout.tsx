import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getPublicBranch } from '@/lib/data';
import { resolveLocale } from '@/lib/page';

/**
 * Проверка филиала ВЫШЕ границы Suspense (loading.tsx этого сегмента): неизвестный филиал
 * отдаёт настоящий HTTP 404, а не «мягкий» 404 внутри потока.
 * TODO(catalog): проверки категории/блюда делать так же — в layout.tsx сегментов
 * [categorySlug] / [dishSlug] (или без loading.tsx), иначе notFound() вернёт статус 200.
 */
export default async function BranchMenuLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; branchSlug: string }>;
}) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();
  return children;
}
