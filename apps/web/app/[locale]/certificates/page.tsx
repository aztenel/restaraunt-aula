import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BranchContactList } from '@/components/branches/BranchContactList';
import { CertificateBalanceCheck } from '@/components/certificates/CertificateBalanceCheck';
import { CertificatePurchaseForm } from '@/components/certificates/CertificatePurchaseForm';
import { ClientMessages } from '@/components/i18n/ClientMessages';
import { Container } from '@/components/ui/Container';
import { Notice } from '@/components/ui/Notice';
import { PageHeading } from '@/components/ui/PageHeading';
import { getCertificateProducts, getConsentText } from '@/lib/content';
import { getPublicBranches } from '@/lib/data';
import { CERTIFICATE_CLIENT_NAMESPACES } from '@/lib/messages';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

export const revalidate = 60;

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Certificates' });
  return buildMetadata({ locale, path: routes.certificates(), title: t('metaTitle'), description: t('metaDescription') });
}

/**
 * Подарочные сертификаты: продукты (GET /public/certificates/products), покупка с обязательным
 * согласием на обработку ПД (текст — GET /public/consents/personal_data), проверка баланса.
 */
export default async function CertificatesPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const [t, products, consent, branches] = await Promise.all([
    getTranslations('Certificates'),
    getCertificateProducts(locale),
    getConsentText(locale, 'personal_data'),
    getPublicBranches(locale),
  ]);
  const contacts = branches.ok ? branches.branches : [];
  const steps = [t('howChoose'), t('howSend'), t('howUse')];
  return (
    <Container>
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      <ClientMessages namespaces={CERTIFICATE_CLIENT_NAMESPACES}>
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <section aria-labelledby="certificate-purchase">
            <h2 id="certificate-purchase" className="text-2xl font-semibold text-earth-900">
              {t('productsTitle')}
            </h2>
            <div className="mt-4">
              {products === null || products.length === 0 ? (
                <div className="space-y-4">
                  <Notice tone={products === null ? 'warning' : 'info'}>{products === null ? t('productsUnavailable') : t('productsEmpty')}</Notice>
                  <BranchContactList branches={contacts} locale={locale} whatsappText={t('whatsappText')} />
                </div>
              ) : (
                <CertificatePurchaseForm
                  products={products}
                  consent={consent ? { version: consent.version, text: consent.text, publishedAt: consent.publishedAt } : null}
                />
              )}
            </div>
          </section>
          <aside className="space-y-6">
            <section aria-labelledby="certificate-how" className="rounded-card bg-earth-800 p-5 text-cream-100">
              <h2 id="certificate-how" className="text-xl font-semibold text-cream-50">
                {t('howTitle')}
              </h2>
              <ol className="mt-3 space-y-3">
                {steps.map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-400 text-sm font-bold text-earth-900">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
            <CertificateBalanceCheck />
          </aside>
        </div>
      </ClientMessages>
    </Container>
  );
}
