import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { Link, redirect } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/button';
import { Container } from '@/components/ui/Container';
import { PageHeading } from '@/components/ui/PageHeading';
import { getPublicBranches, getSelectedBranchSlug, resolveSelectedBranch } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Menu' });
  return buildMetadata({
    locale,
    path: routes.menu(),
    title: t('chooseBranchMetaTitle'),
    description: t('chooseBranchMetaDescription'),
  });
}

/**
 * /menu → меню выбранного филиала (/[branchSlug]/menu): цены задаются по филиалу.
 * Филиал — из cookie; если гость ещё не выбирал и филиал один — сразу его меню;
 * иначе — выбор филиала.
 */
export default async function MenuRedirectPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [result, selectedSlug] = await Promise.all([getPublicBranches(locale), getSelectedBranchSlug()]);
  const t = await getTranslations('Menu');
  const common = await getTranslations('Common');

  if (result.ok) {
    const selected = resolveSelectedBranch(result.branches, selectedSlug);
    const target = selected ?? (result.branches.length === 1 ? result.branches[0] : null);
    if (target) redirect({ href: routes.branchMenu(target.slug), locale });
  }

  return (
    <Container>
      <PageHeading title={t('chooseBranchTitle')} subtitle={t('chooseBranchText')} />
      {result.ok ? (
        result.branches.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2">
            {result.branches.map((branch) => (
              <li key={branch.id}>
                <Link
                  href={routes.branchMenu(branch.slug)}
                  className="flex h-full flex-col rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card hover:border-gold-400"
                >
                  <span className="font-display text-xl font-semibold text-earth-900">{translate(branch.name, locale)}</span>
                  <span className="mt-1 text-muted">{translate(branch.address, locale)}</span>
                  <span className={buttonClasses('primary', 'sm', 'mt-4 self-start')}>{common('menu')}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">{t('noBranches')}</p>
        )
      ) : (
        <p role="status" className="rounded-2xl border border-earth-200 bg-cream-50 p-4 text-earth-700">
          {common('apiUnavailable')}
        </p>
      )}
    </Container>
  );
}
