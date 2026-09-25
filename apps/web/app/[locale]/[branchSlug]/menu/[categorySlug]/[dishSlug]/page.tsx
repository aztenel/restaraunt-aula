import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { BranchMenuPlaceholder } from '@/components/placeholders/BranchMenuPlaceholder';
import { getPublicBranch } from '@/lib/data';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string; categorySlug: string; dishSlug: string }>;

/*
 * TODO(catalog): карточка блюда (фото, состав, вес, цена филиала, модификаторы и добавки).
 *   GET /api/v1/public/catalog/branches/{branchSlug}/dishes/{dishSlug}?locale= → блюдо с ценой филиала,
 *     доступностью, фото, составом, весом, группами модификаторов (опции с ценой Money) | 404
 *   Если categorySlug не совпадает с категорией блюда — редирект 308 на канонический адрес.
 *   Итог с модификаторами НЕ считать на клиенте: показывать цены опций от сервера, итог — из
 *   POST /api/v1/public/orders/quote. SEO: menuItemJsonLd() (Offer в KZT), og:image — фото блюда.
 *   Пока блюдо не проверяется API, страница закрыта от индексации (noindex).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug, categorySlug, dishSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) return {};
  const t = await getTranslations({ locale, namespace: 'Menu' });
  const name = translate(branch.name, locale);
  return buildMetadata({
    locale,
    path: routes.dish(branch.slug, categorySlug, dishSlug),
    title: t('metaTitle', { branch: name }),
    description: t('metaDescription', { branch: name }),
    noindex: true,
  });
}

export default async function DishPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();
  const t = await getTranslations('Menu');
  return <BranchMenuPlaceholder branch={branch} locale={locale} title={t('title')} />;
}
