import { ApiImage } from '@/components/ui/ApiImage';
import { ArrowRightIcon } from '@/components/ui/icons';
import type { Banner } from '@/lib/api-types';
import { isUsableLink, SmartLink } from './SmartLink';

/** Баннеры над меню филиала (menu_top): компактная лента — меню остаётся на первом экране. */
export function MenuBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <ul className="scrollbar-none -mx-4 mt-2 flex snap-x gap-3 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
      {banners.map((banner) => (
        <li key={banner.id} className="w-[85%] max-w-md shrink-0 snap-start">
          <article className="relative flex h-full items-center gap-3 overflow-hidden rounded-2xl border border-gold-300 bg-gold-200/40 p-3">
            {banner.image ? (
              <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-xl">
                <ApiImage fill image={banner.image} alt="" sizes="80px" className="object-cover" />
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="font-semibold text-earth-900">{banner.title}</p>
              {banner.subtitle ? <p className="line-clamp-2 text-sm text-earth-700">{banner.subtitle}</p> : null}
              {isUsableLink(banner.linkUrl) ? (
                <SmartLink
                  href={banner.linkUrl}
                  className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-earth-800 underline underline-offset-4 after:absolute after:inset-0 after:content-['']"
                >
                  {banner.ctaLabel || banner.title}
                  <ArrowRightIcon size={14} />
                </SmartLink>
              ) : null}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
