import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { BanquetRequestForm, type BanquetBranch } from '@/components/banquets/BanquetRequestForm';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { buttonClasses } from '@/components/ui/button';
import { CalendarIcon, CelebrationIcon, CheckIcon, TruckIcon } from '@/components/ui/icons';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { Link } from '@/i18n/navigation';
import type { BanquetEventType } from '@/lib/api-types';
import { getPublicBranches } from '@/lib/data';
import { BANQUET_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';
import { getBanquetEventTypes } from '@/lib/transactions';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FORMATS = ['wedding', 'birthday', 'corporate', 'kudalyk', 'memorial', 'graduation'] as const;
const EVENT_TYPE_CODES = ['wedding', 'birthday', 'corporate', 'anniversary', 'kudalyk', 'memorial', 'graduation', 'other'] as const;
const VENUES = ['vip', 'yurt', 'hall'] as const;
const STEPS = ['request', 'quote', 'agree', 'prepay'] as const;
const CATERING_POINTS = ['p1', 'p2', 'p3'] as const;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Banquets' });
  return buildMetadata({ locale, path: routes.banquets(), title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * Банкеты и кейтеринг: форматы (свадьба, той, корпоратив, құдалық, еске алу, выпускной), VIP-залы и юрты,
 * выездное обслуживание и короткая заявка. Типы мероприятий — справочник API (при ошибке — встроенный
 * список тех же кодов); ?type=code — формат, выбранный на карточке.
 */
export default async function BanquetsPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await resolveLocale(params);
  const [t, result, apiTypes, query] = await Promise.all([getTranslations('Banquets'), getPublicBranches(locale), getBanquetEventTypes(locale), searchParams]);
  const eventTypes: BanquetEventType[] = apiTypes.length > 0 ? apiTypes : EVENT_TYPE_CODES.map((code) => ({ code, label: t(`types.${code}`) }));
  const branches: BanquetBranch[] = (result.ok ? result.branches : []).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: translate(b.name, locale),
    address: translate(b.address, locale),
  }));
  const wanted = typeof query.type === 'string' ? query.type : undefined;
  const initialType = eventTypes.some((type) => type.code === wanted) ? wanted : undefined;

  return (
    <Container>
      <PageHeading title={t('title')} subtitle={t('subtitle')}>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href="#banquet-request" className={buttonClasses('primary', 'lg')}>
            <CelebrationIcon />
            {t('heroCta')}
          </a>
          <Link href={routes.booking()} className={buttonClasses('outline', 'lg')}>
            <CalendarIcon />
            {t('bookCta')}
          </Link>
        </div>
      </PageHeading>

      <section aria-labelledby="banquet-formats" className="py-4">
        <h2 id="banquet-formats" className="text-2xl font-semibold text-earth-900">
          {t('formatsTitle')}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FORMATS.map((code) => (
            <li key={code} className="flex flex-col rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
              <h3 className="text-lg font-semibold text-earth-900">{t(`formats.${code}.title`)}</h3>
              <p className="mt-2 flex-1 text-earth-800">{t(`formats.${code}.text`)}</p>
              <Link
                href={{ pathname: routes.banquets(), query: { type: code }, hash: 'banquet-request' }}
                scroll={false}
                className="mt-3 text-sm font-semibold text-earth-700 underline underline-offset-4"
              >
                {t('formatCta')}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="banquet-venues" className="py-8">
        <h2 id="banquet-venues" className="text-2xl font-semibold text-earth-900">
          {t('venuesTitle')}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {VENUES.map((venue) => (
            <div key={venue} className="rounded-card bg-earth-800 p-5 text-cream-100">
              <h3 className="text-lg font-semibold text-cream-50">{t(`venues.${venue}.title`)}</h3>
              <p className="mt-2">{t(`venues.${venue}.text`)}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="banquet-catering" className="grid gap-6 rounded-card border border-earth-100 bg-cream-50 p-6 md:grid-cols-[1fr_1fr]">
        <div>
          <h2 id="banquet-catering" className="flex items-center gap-2 text-2xl font-semibold text-earth-900">
            <TruckIcon />
            {t('cateringTitle')}
          </h2>
          <p className="mt-2 text-earth-800">{t('cateringText')}</p>
        </div>
        <ul className="space-y-2">
          {CATERING_POINTS.map((point) => (
            <li key={point} className="flex gap-2 text-earth-900">
              <CheckIcon size={20} className="mt-0.5 shrink-0 text-steppe-700" />
              {t(`cateringPoints.${point}`)}
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-8 py-10 lg:grid-cols-[1fr_22rem]">
        <section id="banquet-request" aria-label={t('form.title')} className="scroll-mt-24 rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card sm:p-6">
          <ClientMessages namespaces={BANQUET_CLIENT_NAMESPACES}>
            <BanquetRequestForm eventTypes={eventTypes} branches={branches} initialType={initialType} />
          </ClientMessages>
        </section>
        <aside className="space-y-6">
          <section aria-labelledby="banquet-steps" className="rounded-card bg-earth-800 p-5 text-cream-100">
            <h2 id="banquet-steps" className="text-xl font-semibold text-cream-50">
              {t('stepsTitle')}
            </h2>
            <ol className="mt-3 space-y-3">
              {STEPS.map((step, index) => (
                <li key={step} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-400 text-sm font-bold text-earth-900">{index + 1}</span>
                  <span>{t(`steps.${step}`)}</span>
                </li>
              ))}
            </ol>
          </section>
          {result.ok ? (
            <BranchContactList branches={result.branches} locale={locale} whatsappText={t('whatsappText')} />
          ) : (
            <Notice tone="warning">{t('contactsUnavailable')}</Notice>
          )}
        </aside>
      </div>
    </Container>
  );
}
