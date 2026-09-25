import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { AppLocale } from '@/i18n/routing';
import { OrnamentPattern } from '@/components/brand/Ornament';
import { ApiImage } from '@/components/ui/ApiImage';
import { ArrowRightIcon, TagIcon } from '@/components/ui/icons';
import type { Promotion } from '@/lib/api-types';
import { formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';

/** Срок акции для подписи: «С …», «До …», «… — …» или null (бессрочная). */
export async function promotionPeriod(promotion: Pick<Promotion, 'validFrom' | 'validTo'>, locale: AppLocale): Promise<string | null> {
  const t = await getTranslations('Promotions');
  const from = formatDate(promotion.validFrom, locale);
  const to = formatDate(promotion.validTo, locale);
  if (from && to) return t('validRange', { from, to });
  if (to) return t('validTo', { date: to });
  if (from) return t('validFrom', { date: from });
  return null;
}

/** Филиалы акции: «Во всех филиалах» или список названий. */
export async function promotionBranches(promotion: Pick<Promotion, 'branchIds'>, branchNames: Map<string, string>): Promise<string> {
  const t = await getTranslations('Promotions');
  const names = promotion.branchIds.map((id) => branchNames.get(id)).filter((n): n is string => Boolean(n));
  return promotion.branchIds.length === 0 || names.length === 0 ? t('allBranches') : t('branches', { list: names.join(', ') });
}

export async function PromotionCard({
  promotion,
  locale,
  branchNames,
  headingLevel = 3,
}: {
  promotion: Promotion;
  locale: AppLocale;
  branchNames: Map<string, string>;
  headingLevel?: 2 | 3;
}) {
  const t = await getTranslations('Promotions');
  const period = await promotionPeriod(promotion, locale);
  const branches = await promotionBranches(promotion, branchNames);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="relative flex h-full flex-col overflow-hidden rounded-card border border-earth-100 bg-cream-50 shadow-card focus-within:border-gold-400 hover:border-gold-400">
      <div className="relative aspect-[16/9] bg-earth-700">
        {promotion.image ? (
          <ApiImage fill image={promotion.image} alt="" sizes="(min-width: 1024px) 22rem, (min-width: 640px) 50vw, 100vw" className="object-cover" />
        ) : (
          <>
            <OrnamentPattern className="text-gold-300/15" />
            <TagIcon size={40} className="absolute inset-0 m-auto text-gold-300" />
          </>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {period ? <p className="text-sm font-semibold text-gold-700">{period}</p> : null}
        <Heading className="mt-1 text-xl font-semibold text-earth-900">
          <Link href={routes.promotion(promotion.slug)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">
            {promotion.title}
          </Link>
        </Heading>
        <p className="mt-2 line-clamp-3 text-earth-700">{promotion.description}</p>
        <p className="mt-3 text-sm text-muted">{branches}</p>
        <span className="mt-auto inline-flex items-center gap-1 pt-3 text-sm font-semibold text-earth-700" aria-hidden="true">
          {t('more')}
          <ArrowRightIcon size={16} />
        </span>
      </div>
    </article>
  );
}
