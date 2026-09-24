import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { Link } from '@/i18n/navigation';
import { BranchMap } from '@/components/branches/BranchMap';
import { OpenStatusBadge } from '@/components/branches/OpenStatusBadge';
import { OpeningHoursTable } from '@/components/branches/OpeningHoursTable';
import { RememberBranch } from '@/components/branches/RememberBranch';
import { JsonLd } from '@/components/seo/JsonLd';
import { buttonClasses } from '@/components/ui/button';
import { Container } from '@/components/ui/Container';
import { BagIcon, CalendarIcon, MapPinIcon, PhoneIcon, TruckIcon, UtensilsIcon, WhatsAppIcon } from '@/components/ui/icons';
import { PageHeading } from '@/components/ui/PageHeading';
import { getSiteUrl } from '@/lib/config';
import { getPublicBranch } from '@/lib/data';
import { formatPhone, googleMapsHref, telHref, whatsappHref, yandexRouteHref } from '@/lib/format';
import { breadcrumbJsonLd, restaurantJsonLd } from '@/lib/jsonld';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata, localizedUrl } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) return {};
  const t = await getTranslations({ locale, namespace: 'Branches' });
  const name = translate(branch.name, locale);
  return buildMetadata({
    locale,
    path: routes.branch(branch.slug),
    title: t('branchMetaTitle', { name }),
    description: t('branchMetaDescription', { name, address: translate(branch.address, locale) }),
  });
}

export default async function BranchPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();

  const t = await getTranslations('Branches');
  const common = await getTranslations('Common');
  const nav = await getTranslations('Nav');
  const siteUrl = getSiteUrl();
  const name = translate(branch.name, locale);
  const address = translate(branch.address, locale);
  const pageUrl = localizedUrl(locale, routes.branch(branch.slug), siteUrl);

  const services = [
    { key: 'delivery', enabled: branch.acceptsDelivery, icon: TruckIcon },
    { key: 'pickup', enabled: branch.acceptsPickup, icon: BagIcon },
    { key: 'reservations', enabled: branch.acceptsReservations, icon: CalendarIcon },
  ] as const;

  return (
    <Container>
      <RememberBranch branchId={branch.id} slug={branch.slug} />
      <JsonLd
        data={[
          restaurantJsonLd({
            branch,
            locale,
            url: pageUrl,
            menuUrl: localizedUrl(locale, routes.branchMenu(branch.slug), siteUrl),
          }),
          breadcrumbJsonLd([
            { name: nav('home'), url: localizedUrl(locale, routes.home(), siteUrl) },
            { name: t('title'), url: localizedUrl(locale, routes.branches(), siteUrl) },
            { name, url: pageUrl },
          ]),
        ]}
      />
      <nav aria-label="breadcrumb" className="pt-6 text-sm text-muted">
        <Link href={routes.branches()} className="underline-offset-4 hover:underline">
          {t('allBranches')}
        </Link>
      </nav>
      <PageHeading title={name} className="pt-2 sm:pt-4">
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OpenStatusBadge isOpen={branch.isOpenNow} openLabel={common('openNow')} closedLabel={common('closedNow')} />
          <p className="flex items-center gap-1.5 text-earth-700">
            <MapPinIcon size={18} className="text-earth-400" />
            <span>{address}</span>
          </p>
        </div>
      </PageHeading>

      <div className="flex flex-col gap-3 sm:flex-row">
        <Link href={routes.branchMenu(branch.slug)} className={buttonClasses('primary', 'lg')}>
          <UtensilsIcon />
          {t('menuCta')}
        </Link>
        {branch.acceptsReservations ? (
          <Link href={routes.booking()} className={buttonClasses('secondary', 'lg')}>
            <CalendarIcon />
            {t('bookCta')}
          </Link>
        ) : null}
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1.3fr]">
        <div className="space-y-8">
          <section aria-labelledby="branch-contacts">
            <h2 id="branch-contacts" className="text-2xl font-semibold text-earth-900">
              {t('contacts')}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={telHref(branch.phone)} className={buttonClasses('outline')}>
                <PhoneIcon />
                {formatPhone(branch.phone)}
              </a>
              {branch.whatsapp ? (
                <a href={whatsappHref(branch.whatsapp)} target="_blank" rel="noopener noreferrer" className={buttonClasses('whatsapp')}>
                  <WhatsAppIcon />
                  {common('writeWhatsapp')}
                </a>
              ) : null}
            </div>
          </section>

          <section aria-labelledby="branch-services">
            <h2 id="branch-services" className="text-2xl font-semibold text-earth-900">
              {t('services')}
            </h2>
            <ul className="mt-4 flex flex-wrap gap-2">
              {services
                .filter((s) => s.enabled)
                .map(({ key, icon: Icon }) => (
                  <li key={key} className="inline-flex items-center gap-2 rounded-full bg-cream-50 px-4 py-2 text-earth-800 ring-1 ring-earth-100">
                    <Icon size={18} />
                    {t(key)}
                  </li>
                ))}
            </ul>
          </section>

          <section aria-labelledby="branch-hours">
            <h2 id="branch-hours" className="text-2xl font-semibold text-earth-900">
              {t('hours')}
            </h2>
            <div className="mt-4 overflow-hidden rounded-card border border-earth-100 bg-cream-50">
              <OpeningHoursTable hours={branch.openingHours} timeZone={branch.timezone} />
            </div>
          </section>
        </div>

        <section aria-labelledby="branch-map">
          <h2 id="branch-map" className="text-2xl font-semibold text-earth-900">
            {t('map')}
          </h2>
          <div className="mt-4">
            <BranchMap lat={branch.location.lat} lng={branch.location.lng} label={t('mapAria', { name })} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={yandexRouteHref(branch.location.lat, branch.location.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('outline', 'sm')}
            >
              {common('route')}
            </a>
            <a
              href={googleMapsHref(branch.location.lat, branch.location.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses('ghost', 'sm')}
            >
              {common('openInGoogleMaps')}
            </a>
          </div>
        </section>
      </div>
    </Container>
  );
}
