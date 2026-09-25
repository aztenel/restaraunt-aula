import clsx from 'clsx';
import { RamHorn } from '@/components/brand/Ornament';

/** Блюдо без фото: орнамент на месте изображения (те же размеры — без сдвига вёрстки). */
export function DishPhotoPlaceholder({ className, label }: { className?: string; label?: string }) {
  return (
    <div
      className={clsx('absolute inset-0 grid place-items-center bg-cream-200 text-earth-200', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <RamHorn className="h-10 w-16" strokeWidth={2} />
    </div>
  );
}
