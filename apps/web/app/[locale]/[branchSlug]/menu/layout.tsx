import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { RememberBranch } from '@/components/branches/RememberBranch';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { getPublicBranch } from '@/lib/data';
import { MENU_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale } from '@/lib/page';

/**
 * Меню филиала. Проверка филиала — ВЫШЕ границ Suspense (loading.tsx лежат в группах (index)/(list)
 * и в сегменте блюда): неизвестный филиал отдаёт настоящий HTTP 404, а не «мягкий» 404 в потоке.
 * Категория и блюдо проверяются так же — в layout.tsx своих сегментов.
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
  return (
    <ClientMessages namespaces={MENU_CLIENT_NAMESPACES}>
      <RememberBranch branchId={branch.id} slug={branch.slug} />
      {children}
    </ClientMessages>
  );
}
