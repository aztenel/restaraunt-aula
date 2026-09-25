/**
 * Проверка файлов изображений до загрузки — те же ограничения, что у сервера (catalog/domain/images.ts):
 * JPEG/PNG/WebP, до 10 МБ, у блюда — не больше 10 фото. Ширину (от 300 px) проверяет сервер.
 */
import type { CatalogImage } from '@aula/api-client';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTOS_PER_DISH = 10;

export type ImageFileIssue = 'type' | 'size' | 'count';

export interface ImageFileCheck<F> {
  accepted: F[];
  rejected: Array<{ file: F; issue: ImageFileIssue }>;
}

/** Разделить файлы на подходящие и отклонённые; limit — сколько ещё можно добавить (фото блюда). */
export function checkImageFiles<F extends { type: string; size: number }>(files: readonly F[], limit = Number.POSITIVE_INFINITY): ImageFileCheck<F> {
  const result: ImageFileCheck<F> = { accepted: [], rejected: [] };
  for (const file of files) {
    if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) result.rejected.push({ file, issue: 'type' });
    else if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) result.rejected.push({ file, issue: 'size' });
    else if (result.accepted.length >= limit) result.rejected.push({ file, issue: 'count' });
    else result.accepted.push(file);
  }
  return result;
}

/** Самый узкий вариант не уже width (миниатюры в таблицах), иначе самый широкий. */
export function imageVariantUrl(image: CatalogImage | null | undefined, width: number): string | undefined {
  if (!image) return undefined;
  const sorted = [...image.variants].sort((a, b) => a.width - b.width);
  return (sorted.find((v) => v.width >= width) ?? sorted[sorted.length - 1])?.url ?? image.url;
}

/** Самый широкий вариант (просмотр). */
export function largestImageUrl(image: CatalogImage | null | undefined): string | undefined {
  if (!image) return undefined;
  const sorted = [...image.variants].sort((a, b) => b.width - a.width);
  return sorted[0]?.url ?? image.url;
}
