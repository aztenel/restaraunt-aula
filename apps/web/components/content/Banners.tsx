import clsx from 'clsx';
import { getTranslations } from 'next-intl/server';
import { OrnamentPattern } from '@/components/brand/Ornament';
import { ApiImage } from '@/components/ui/ApiImage';
import { buttonClasses } from '@/components/ui/button';
import { Container } from '@/components/ui/Container';
import { ArrowRightIcon } from '@/components/ui/icons';
import type { Banner } from '@/lib/api-types';
import { isUsableLink, SmartLink } from './SmartLink';

/**
 * Баннеры главной (home_hero): полноширинная лента с прокруткой-«защёлкой» (свайп на телефоне,
 * без JS). Первый баннер — изображение первого экрана (priority), остальные — лениво.
 */
export async function HeroBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  const t = await getTranslations('Home');
  return (
    <section aria-label={t('bannersLabel')} className="bg-earth-900">
      <ul className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto">
        {banners.map((banner, index) => (
          <li
            key={banner.id}
            className="relative isolate w-full shrink-0 snap-center overflow-hidden"
            aria-roledescription="slide"
            aria-label={banners.length > 1 ? t('bannerSlide', { index: index + 1, total: banners.length }) : undefined}
          >
            <div className="relative h-[22rem] sm:h-[26rem] lg:h-[30rem]">
              {banner.image ? (
                <ApiImage fill image={banner.image} alt="" sizes="100vw" priority={index === 0} className="-z-10 object-cover" />
              ) : (
                <OrnamentPattern className="-z-10 text-gold-400/10" />
              )}
              <div className="absolute inset-0 -z-10 bg-gradient-to-t from-earth-900/90 via-earth-900/50 to-earth-900/10" aria-hidden="true" />
              <Container className="flex h-full flex-col justify-end pb-8 text-cream-50 sm:pb-12">
                {/* Заголовок страницы (h1) — ниже, в блоке бренда; текст баннера — рекламный, не заголовок. */}
                <p className="max-w-2xl font-display text-3xl font-semibold leading-tight text-balance sm:text-4xl lg:text-5xl">{banner.title}</p>
                {banner.subtitle ? <p className="mt-3 max-w-xl text-lg text-cream-200">{banner.subtitle}</p> : null}
                {isUsableLink(banner.linkUrl) ? (
                  <SmartLink href={banner.linkUrl} className={buttonClasses('secondary', 'lg', 'mt-6 self-start')}>
                    {banner.ctaLabel || banner.title}
                    <ArrowRightIcon />
                  </SmartLink>
                ) : null}
                {banners.length > 1 ? (
                  <p className="mt-4 text-sm font-semibold text-cream-300" aria-hidden="true">
                    {t('bannerSlide', { index: index + 1, total: banners.length })}
                  </p>
                ) : null}
              </Container>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Карточки баннеров (home_secondary): изображение 16:9, заголовок, призыв. */
export function BannerCards({ banners, className }: { banners: Banner[]; className?: string }) {
  if (banners.length === 0) return null;
  return (
    <ul className={clsx('grid gap-4 md:grid-cols-2', className)}>
      {banners.map((banner) => (
        <li key={banner.id}>
          <article className="relative flex h-full flex-col overflow-hidden rounded-card border border-earth-100 bg-cream-50 shadow-card">
            <div className="relative aspect-[16/9] bg-earth-700">
              {banner.image ? (
                <ApiImage fill image={banner.image} alt="" sizes="(min-width: 768px) 50vw, 100vw" className="object-cover" />
              ) : (
                <OrnamentPattern className="text-gold-300/15" />
              )}
            </div>
            <div className="flex flex-1 flex-col p-5">
              <h3 className="text-xl font-semibold text-earth-900">{banner.title}</h3>
              {banner.subtitle ? <p className="mt-1 text-muted">{banner.subtitle}</p> : null}
              {isUsableLink(banner.linkUrl) ? (
                <SmartLink
                  href={banner.linkUrl}
                  className="mt-auto inline-flex min-h-11 items-center gap-1 pt-3 font-semibold text-earth-700 underline-offset-4 after:absolute after:inset-0 after:content-[''] hover:underline"
                >
                  {banner.ctaLabel || banner.title}
                  <ArrowRightIcon size={18} />
                </SmartLink>
              ) : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
