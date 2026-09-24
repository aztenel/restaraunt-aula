import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { routing } from '@/i18n/routing';
import { Analytics } from '@/components/analytics';
import { BottomNav } from '@/components/layout/BottomNav';
import { Footer } from '@/components/layout/Footer';
import { Header } from '@/components/layout/Header';
import { CartProvider } from '@/lib/cart';
import { getSiteUrl } from '@/lib/config';
import { getPublicBranches, getSelectedBranchSlug, resolveSelectedBranch } from '@/lib/data';
import { fontVariables } from '@/lib/fonts';
import { CLIENT_NAMESPACES, pickMessages } from '@/lib/messages';
import { SITE_NAME } from '@/lib/seo';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#57351e',
};

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: 'Metadata' });
  return {
    metadataBase: new URL(getSiteUrl()),
    title: { default: t('homeTitle'), template: `%s — ${SITE_NAME}` },
    description: t('homeDescription'),
    applicationName: SITE_NAME,
    // Телефоны оформлены ссылками tel: явно — автоопределение Safari не нужно.
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [branchesResult, selectedSlug, messages, t] = await Promise.all([
    getPublicBranches(locale),
    getSelectedBranchSlug(),
    getMessages(),
    getTranslations('Common'),
  ]);
  const branches = branchesResult.ok ? branchesResult.branches : [];
  const selected = resolveSelectedBranch(branches, selectedSlug);
  const branchOptions = branches.map((b) => ({ id: b.id, slug: b.slug, name: translate(b.name, locale) }));

  return (
    <html lang={locale} className={fontVariables}>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-earth-800 px-4 py-3 font-semibold text-cream-50 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          {t('skipToContent')}
        </a>
        <NextIntlClientProvider messages={pickMessages(messages, CLIENT_NAMESPACES)}>
          <CartProvider>
            <Header branches={branchOptions} selectedSlug={selected?.slug ?? null} />
            <main id="main" className="pb-safe-nav flex-1 md:pb-0">
              {children}
            </main>
            <Footer locale={locale} branches={branches} />
            <BottomNav />
          </CartProvider>
        </NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
