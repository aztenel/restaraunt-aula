import { ValidationError } from '../../../shared/kernel/errors';

/**
 * Изображения залов и мест: фон плана зала и фото места (витрина показывает их при выборе места).
 * Загрузка -> webp фиксированной ширины (без увеличения) в публичном хранилище; в БД — ключи файлов.
 */
export type ImageTarget = 'venues' | 'halls';

export const IMAGE_VARIANT_WIDTHS: Record<ImageTarget, readonly number[]> = {
  venues: [1600, 800, 400],
  halls: [2400, 1200],
};

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MIN_IMAGE_WIDTH = 300;
export const MAX_PHOTOS_PER_VENUE = 10;

export interface ImageVariant {
  width: number;
  height: number;
  key: string;
}

export interface StoredImage {
  id: string;
  variants: ImageVariant[];
}

export function assertUploadableImage(file: { mimetype: string; size: number } | undefined): void {
  if (!file) throw new ValidationError('reservation.image_required', 'Image file is required (multipart field "file")');
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.mimetype)) {
    throw new ValidationError('reservation.image_invalid_type', 'Image must be JPEG, PNG or WebP', {
      mimetype: file.mimetype,
      allowed: ALLOWED_IMAGE_TYPES,
    });
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new ValidationError('reservation.image_too_large', 'Image must be up to 10 MB', { size: file.size, max: MAX_IMAGE_BYTES });
  }
}

export function assertImageDimensions(width: number | undefined, height: number | undefined): void {
  if (!width || !height) throw new ValidationError('reservation.image_invalid', 'Cannot read image dimensions');
  if (width < MIN_IMAGE_WIDTH) {
    throw new ValidationError('reservation.image_too_small', `Image must be at least ${MIN_IMAGE_WIDTH}px wide`, { width });
  }
}

/** Ширины вариантов для исходника: не больше исходной ширины (без увеличения), минимум один вариант. */
export function variantWidths(target: ImageTarget, sourceWidth: number): number[] {
  const widths = IMAGE_VARIANT_WIDTHS[target].filter((w) => w <= sourceWidth);
  return widths.length > 0 ? [...widths] : [sourceWidth];
}

/** Ключ файла в хранилище: reservation/<target>/<owner>/<image>-<width>.webp. */
export function imageKey(target: ImageTarget, ownerId: string, imageId: string, width: number): string {
  return `reservation/${target}/${ownerId}/${imageId}-${width}.webp`;
}

/** Вариант для показа: наименьший не уже требуемой ширины, иначе самый широкий. */
export function pickVariant(image: StoredImage, width: number): ImageVariant | null {
  const sorted = [...image.variants].sort((a, b) => a.width - b.width);
  return sorted.find((v) => v.width >= width) ?? sorted[sorted.length - 1] ?? null;
}

export function assertPhotoLimit(existing: number, adding: number): void {
  if (existing + adding > MAX_PHOTOS_PER_VENUE) {
    throw new ValidationError('reservation.too_many_photos', `A venue can have at most ${MAX_PHOTOS_PER_VENUE} photos`, {
      max: MAX_PHOTOS_PER_VENUE,
      existing,
    });
  }
}

export function isStoredImage(value: unknown): value is StoredImage {
  if (!value || typeof value !== 'object') return false;
  const v = value as StoredImage;
  return typeof v.id === 'string' && Array.isArray(v.variants);
}
