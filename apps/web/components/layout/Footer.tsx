import { getTranslations } from 'next-intl/server';
import { translate, type PublicBranch } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { Logo } from '@/components/brand/Logo';
import { RamHorn } from '@/components/brand/Ornament';
import { PhoneIcon, WhatsAppIcon } from '@/components/ui/icons';
import { formatPhone, telHref, whatsappHref } from '@/lib/format';
import { INFO_PAGES, LEGAL_PAGES, routes } from '@/lib/routes';

const linkClass = 'inline-flex min-h-10 items-center hover:text-gold-300';

export async function Footer({ locale, branches }: { locale: AppLocale; branches: PublicBranch[] }) {
  const t = await getTranslations('Footer');
  const nav = await getTranslations('Nav');
  const year = new Date().getFullYear();
  return (
    <footer className="relative mt-16 overflow-hidden bg-earth-900 text-cream-200">
      <RamHorn className="pointer-events-none absolute -right-10 -top-6 h-48 w-80 text-earth-800" strokeWidth={1.2} />
      <div className="relative mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.1fr_1.8fr_1fr_1fr]">
        <div>
          <Logo inverted />
          <p className="mt-4 max-w-xs text-sm text-cream-300">{t('tagline')}</p>
          <p className="mt-2 text-sm text-cream-300">{t('paymentNote')}</p>
        </div>

        <section aria-labelledby="footer-branches">
          <h2 id="footer-branches" className="font-display text-lg font-semibold text-cream-50">
            {t('branches')}
          </h2>
          <ul className="mt-4 grid gap-6 sm:grid-cols-2">
            {branches.map((branch) => (
              <li key={branch.id}>
                <Link href={routes.branch(branch.slug)} className="font-semibold text-cream-50 underline-offset-4 hover:underline">
                  {translate(branch.name, locale)}
                </Link>
                <address className="mt-1 text-sm not-italic text-cream-300">{translate(branch.address, locale)}</address>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  <a href={telHref(branch.phone)} className="inline-flex min-h-11 items-center gap-1.5 hover:text-gold-300">
                    <PhoneIcon size={16} />
                    {formatPhone(branch.phone)}
                  </a>
                  {branch.whatsapp ? (
                    <a
                      href={whatsappHref(branch.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-1.5 hover:text-gold-300"
                    >
                      <WhatsAppIcon size={16} />
                      WhatsApp
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <nav aria-labelledby="footer-info">
          <h2 id="footer-info" className="font-display text-lg font-semibold text-cream-50">
            {t('info')}
          </h2>
          <ul className="mt-4 space-y-1 text-sm">
            {INFO_PAGES.map((slug) => (
              <li key={slug}>
                <Link href={routes.page(slug)} className={linkClass}>
                  {t(slug)}
                </Link>
              </li>
            ))}
            <li>
              <Link href={routes.promotions()} className={linkClass}>
                {t('promotions')}
              </Link>
            </li>
            <li>
              <Link href={routes.certificates()} className={linkClass}>
                {nav('certificates')}
              </Link>
            </li>
            <li>
              <Link href={routes.branches()} className={linkClass}>
                {nav('branches')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="font-display text-lg font-semibold text-cream-50">
            {t('legal')}
          </h2>
          <ul className="mt-4 space-y-1 text-sm">
            {LEGAL_PAGES.map((slug) => (
              <li key={slug}>
                <Link href={routes.page(slug)} className={linkClass}>
                  {t(slug)}
                </Link>
              </li>
            ))}
            <li>
              <Link href={routes.consent('personal-data')} className={linkClass}>
                {t('personalData')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="relative border-t border-earth-800">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-5 text-xs text-cream-300 sm:flex-row sm:justify-between sm:px-6">
          <p>{t('rights', { year })}</p>
          <p>{t('legalEntity')}</p>
        </div>
      </div>
    </footer>
  );
}
