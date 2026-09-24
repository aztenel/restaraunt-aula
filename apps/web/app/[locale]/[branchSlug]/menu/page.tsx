import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { translate } from '@aula/api-client';
import { BranchMenuPlaceholder } from '@/components/placeholders/BranchMenuPlaceholder';
import { getPublicBranch } from '@/lib/data';
import { resolveLocale } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

type Params = Promise<{ locale: string; branchSlug: string }>;

/*
 * TODO(catalog): каталог филиала — модуль Catalog.
 *   Ожидаемый эндпоинт: GET /api/v1/public/branches/{branchSlug}/menu?locale=kk|ru|en
 *     → { branch: { id, slug, name }, categories: [{ id, slug, name, description, dishes: [{ id, slug, name,
 *        description, photoUrl, weightGrams, price: Money, availability: 'available' | 'stopped_shown',
 *        tags: ['vegetarian' | 'spicy' | 'halal' ...] }] }] }
 *   Поиск и фильтры (вегетарианское, острое, халал, до N тенге) — параметры запроса, фильтрует сервер:
 *     ?q=&tags=vegetarian,spicy&maxPrice=<тиыны>
 *   Кэш: createServerApi({ locale, tags: ['menu', `menu:${branchSlug}`] }) (revalidate 60 с).
 *   SEO: menuJsonLd() из lib/jsonld.ts + restaurantJsonLd(); цены — только formatPrice(money, locale).
 *   Добавление в корзину: useCart().add({ dishId, modifierOptionIds, branchId }) + reachGoal(Goals.AddToCart).
 */
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) return {};
  const t = await getTranslations({ locale, namespace: 'Menu' });
  const name = translate(branch.name, locale);
  return buildMetadata({
    locale,
    path: routes.branchMenu(branch.slug),
    title: t('metaTitle', { branch: name }),
    description: t('metaDescription', { branch: name }),
  });
}

export default async function BranchMenuPage({ params }: { params: Params }) {
  const locale = await resolveLocale(params);
  const { branchSlug } = await params;
  const branch = await getPublicBranch(locale, branchSlug);
  if (!branch) notFound();
  const t = await getTranslations('Menu');
  return <BranchMenuPlaceholder branch={branch} locale={locale} title={t('title')} />;
}
