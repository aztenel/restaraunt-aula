import { ValidationError } from '../../../shared/kernel/errors';

/**
 * Изображения меню и контента: загрузка -> webp-варианты фиксированной ширины (публичное хранилище).
 * Витрина выбирает вариант под экран (srcset), по умолчанию — средний.
 */
export type ImageKind = 'dishes' | 'categories' | 'banners' | 'promotions';

export const IMAGE_VARIANT_WIDTHS: Record<ImageKind, readonly number[]> = {
  dishes: [1200, 600, 300],
  categories: [1200, 600, 300],
  banners: [1920, 1200, 600],
  promotions: [1200, 600, 300],
};

/** Ширина варианта «по умолчанию» (url в API). */
export const DEFAULT_IMAGE_WIDTH: Record<ImageKind, number> = {
  dishes: 600,
  categories: 600,
  banners: 1200,
  promotions: 600,
};

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_WIDTH = 300;
export const MAX_PHOTOS_PER_DISH = 10;

export interface ImageVariant {
  width: number;
  height: number;
  key: string;
}

export interface StoredImage {
  id: string;
  variants: ImageVariant[];
}

export function assertUploadableImage(file: { mimetype: string; size: number }): void {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new ValidationError('catalog.image_invalid_type', 'Image must be JPEG, PNG or WebP', {
      mimetype: file.mimetype,
      allowed: ALLOWED_IMAGE_TYPES,
    });
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ValidationError('catalog.image_too_large', 'Image must be up to 10 MB', { size: file.size, max: MAX_IMAGE_BYTES });
  }
}

export function assertImageDimensions(width: number | undefined, height: number | undefined): void {
  if (!width || !height) throw new ValidationError('catalog.image_invalid', 'Cannot read image dimensions');
  if (width < MIN_IMAGE_WIDTH) {
    throw new ValidationError('catalog.image_too_small', `Image must be at least ${MIN_IMAGE_WIDTH}px wide`, { width });
  }
}

/** Ключ файла в хранилище: catalog/<kind>/<owner>/<image>-<width>.webp. */
export function imageKey(kind: ImageKind, ownerId: string, imageId: string, width: number): string {
  return `catalog/${kind}/${ownerId}/${imageId}-${width}.webp`;
}

/** Вариант для показа: наименьший не уже требуемой ширины, иначе самый широкий. */
export function pickVariant(image: StoredImage, width: number): ImageVariant | null {
  const sorted = [...image.variants].sort((a, b) => a.width - b.width);
  return sorted.find((v) => v.width >= width) ?? sorted[sorted.length - 1] ?? null;
}

export function isStoredImage(value: unknown): value is StoredImage {
  if (!value || typeof value !== 'object') return false;
  const v = value as StoredImage;
  return typeof v.id === 'string' && Array.isArray(v.variants);
}
