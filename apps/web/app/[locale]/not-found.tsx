import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { OrnamentDivider } from '@/components/brand/Ornament';
import { buttonClasses } from '@/components/ui/button';
import { Container } from '@/components/ui/Container';
import { routes } from '@/lib/routes';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('NotFound');
  // noindex для 404 Next.js добавляет сам.
  return { title: t('title') };
}

export default async function NotFound() {
  const t = await getTranslations('NotFound');
  return (
    <Container className="py-16 text-center sm:py-24">
      <p className="font-display text-7xl font-semibold text-earth-700">404</p>
      <OrnamentDivider className="mx-auto mt-4 max-w-48" />
      <h1 className="mt-6 text-3xl font-semibold text-earth-900">{t('title')}</h1>
      <p className="mx-auto mt-3 max-w-md text-lg text-muted">{t('text')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href={routes.home()} className={buttonClasses('primary')}>
          {t('home')}
        </Link>
        <Link href={routes.menu()} className={buttonClasses('outline')}>
          {t('menu')}
        </Link>
      </div>
    </Container>
  );
}
