import { notFound } from 'next/navigation';
import { permanentRedirect } from '@/i18n/navigation';
import { getPublicBranch } from '@/lib/data';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';

type Params = Promise<{ locale: string; branchSlug: string }>;

/** /[locale]/[branchSlug] — короткий адрес филиала → страница филиала; иначе локализованная 404. */
export default async function BranchShortcutPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();
  permanentRedirect({ href: routes.branch(branch.slug), locale });
}
