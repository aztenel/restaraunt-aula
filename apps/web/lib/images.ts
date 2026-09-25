/**
 * Изображения меню и контента: API отдаёт готовые webp-варианты фиксированной ширины
 * (блюда и категории 300/600/1200, баннеры 600/1200/1920). next/image работает с ними через
 * собственный loader: браузер получает srcset из вариантов CDN, повторного сжатия на сервере
 * Next.js нет (меньше нагрузки при 300 одновременных посетителях).
 */
import type { ApiImage } from './api-types';

/**
 * Ширины для srcset next/image (next.config.ts → images.deviceSizes/imageSizes) совпадают
 * с вариантами API — описатель ширины в srcset соответствует реальному файлу.
 */
export const IMAGE_DEVICE_SIZES = [300, 600, 1200, 1920];
export const IMAGE_SIZES = [150];

/** Вариант под ширину: наименьший не уже требуемой, иначе самый широкий (как pickVariant на сервере). */
export function pickVariantUrl(image: Pick<ApiImage, 'url' | 'variants'>, width: number): string {
  const sorted = [...(image.variants ?? [])].sort((a, b) => a.width - b.width);
  if (sorted.length === 0) return image.url;
  return (sorted.find((v) => v.width >= width) ?? sorted[sorted.length - 1]!).url;
}

/** Самый широкий вариант — для og:image и JSON-LD. */
export function largestVariantUrl(image: Pick<ApiImage, 'url' | 'variants'>): string {
  const sorted = [...(image.variants ?? [])].sort((a, b) => b.width - a.width);
  return sorted[0]?.url ?? image.url;
}

/** Изображение для OpenGraph: вариант ~1200 px (рекомендация соцсетей), с размерами. */
export function openGraphImage(image: ApiImage | null | undefined, alt: string): { url: string; width: number; height: number; alt: string } | null {
  if (!image) return null;
  const sorted = [...(image.variants ?? [])].sort((a, b) => a.width - b.width);
  const variant = sorted.find((v) => v.width >= 1200) ?? sorted[sorted.length - 1];
  if (!variant) return { url: image.url, width: image.width, height: image.height, alt };
  return { url: variant.url, width: variant.width, height: variant.height, alt };
}

/** Абсолютный URL (для JSON-LD/OG): относительный путь API дополняется origin API. */
export function absoluteUrl(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!origin) return url;
  return `${origin.replace(/\/+$/, '')}${url.startsWith('/') ? '' : '/'}${url}`;
}
