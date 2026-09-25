'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiImage } from '@/components/ui/ApiImage';
import type { ApiImage as ApiImageData } from '@/lib/api-types';
import { DishPhotoPlaceholder } from './DishPhotoPlaceholder';

/**
 * Фото блюда: основное (первый экран — без lazy) и миниатюры. Соотношение сторон задано —
 * без сдвига вёрстки; миниатюры берут самый маленький webp-вариант.
 */
export function DishGallery({ photos, name, unavailable = false }: { photos: ApiImageData[]; name: string; unavailable?: boolean }) {
  const t = useTranslations('Dish');
  const [index, setIndex] = useState(0);
  const current = photos[index] ?? photos[0];

  return (
    <div>
      <div className="relative aspect-[4/3] overflow-hidden rounded-card bg-cream-200 shadow-card">
        {current ? (
          <ApiImage
            key={current.id}
            fill
            priority={index === 0}
            image={current}
            alt={photos.length > 1 ? `${name} — ${t('photo', { index: index + 1, total: photos.length })}` : name}
            sizes="(min-width: 1152px) 34rem, (min-width: 768px) 50vw, 100vw"
            className={clsx('object-cover', unavailable && 'grayscale')}
          />
        ) : (
          <DishPhotoPlaceholder label={t('noPhoto')} />
        )}
      </div>
      {photos.length > 1 ? (
        <ul className="scrollbar-none mt-3 flex gap-2 overflow-x-auto" aria-label={t('gallery')}>
          {photos.map((photo, i) => (
            <li key={photo.id} className="shrink-0">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={t('photo', { index: i + 1, total: photos.length })}
                aria-pressed={i === index}
                className={clsx(
                  'relative block h-16 w-20 overflow-hidden rounded-xl border-2 bg-cream-200',
                  i === index ? 'border-gold-500' : 'border-transparent opacity-80 hover:opacity-100',
                )}
              >
                <ApiImage fill image={photo} alt="" sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
