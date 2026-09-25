'use client';

import Image, { type ImageLoader } from 'next/image';
import { useCallback } from 'react';
import type { ApiImage as ApiImageData } from '@/lib/api-types';
import { pickVariantUrl } from '@/lib/images';

type Props = {
  image: Pick<ApiImageData, 'url' | 'width' | 'height' | 'variants'>;
  alt: string;
  /** Подсказка ширины для srcset (обязательна: без неё браузер возьмёт самый большой вариант). */
  sizes: string;
  className?: string;
  /** Изображение первого экрана (LCP): без lazy, с высоким приоритетом загрузки. */
  priority?: boolean;
  /** Заполнить родителя (родитель — relative с заданным соотношением сторон, без сдвига вёрстки). */
  fill?: boolean;
};

/**
 * Фото из API через next/image: srcset собирается из готовых webp-вариантов CDN (свой loader),
 * ленивая загрузка по умолчанию, размеры заданы — без сдвига вёрстки (CLS).
 */
export function ApiImage({ image, alt, sizes, className, priority = false, fill = false }: Props) {
  const loader = useCallback<ImageLoader>(({ width }) => pickVariantUrl(image, width), [image]);
  const common = { loader, src: image.url, sizes, className, priority, loading: priority ? undefined : ('lazy' as const) };
  return fill ? (
    <Image {...common} alt={alt} fill />
  ) : (
    <Image {...common} alt={alt} width={image.width} height={image.height} />
  );
}
