import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getConsentText } from '@/lib/content';
import { formatDate } from '@/lib/format';
import { resolveLocale } from '@/lib/page';
import { CONSENT_SLUGS, routes, type ConsentSlug } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; kind: string }>;

export const revalidate = 300;

function isConsentSlug(value: string): value is ConsentSlug {
  return Object.prototype.hasOwnProperty.call(CONSENT_SLUGS, value);
}

const TITLE_KEYS = { 'personal-data': 'personalDataTitle', marketing: 'marketingTitle' } as const;
const DESCRIPTION_KEYS = { 'personal-data': 'personalDataDescription', marketing: 'marketingDescription' } as const;

/**
 * Действующий текст согласия (GET /api/v1/public/consents/{kind}) — ссылка из форм
 * (покупка сертификата, заказ, бронь). Версия текста фиксируется сервером вместе с согласием.
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { kind } = await params;
  if (!isConsentSlug(kind)) return {};
  const t = await getTranslations({ locale, namespace: 'Consent' });
  return buildMetadata({ locale, path: routes.consent(kind), title: t(TITLE_KEYS[kind]), description: t(DESCRIPTION_KEYS[kind]) });
}

export default async function ConsentPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { kind } = await params;
  if (!isConsentSlug(kind)) notFound();
  const [consent, t, nav] = await Promise.all([getConsentText(locale, CONSENT_SLUGS[kind]), getTranslations('Consent'), getTranslations('Nav')]);
  const title = t(TITLE_KEYS[kind]);
  return (
    <Container>
      <Breadcrumbs items={[{ label: nav('home'), href: routes.home() }, { label: title }]} />
      <PageHeading title={title} compact>
        {consent ? <p className="mt-2 text-sm text-muted">{t('version', { date: formatDate(consent.publishedAt, locale) })}</p> : null}
      </PageHeading>
      {consent ? (
        <article className="max-w-3xl whitespace-pre-line text-lg leading-relaxed text-earth-900">{consent.text}</article>
      ) : (
        <Notice tone="warning">{t('unavailable')}</Notice>
      )}
    </Container>
  );
}
