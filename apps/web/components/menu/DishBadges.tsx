import clsx from 'clsx';
import { FlameIcon, LeafIcon } from '@/components/ui/icons';
import type { DishCard } from '@/lib/api-types';

export interface DishBadgeLabels {
  vegetarian: string;
  spicy: string;
  spicyLevel: string;
  halal: string;
}

/** Метки блюда: вегетарианское, острое (с уровнем для экранного чтеца), халал. */
export function DishBadges({
  dish,
  labels,
  className,
}: {
  dish: Pick<DishCard, 'isVegetarian' | 'spicyLevel' | 'isHalal'>;
  labels: DishBadgeLabels;
  className?: string;
}) {
  if (!dish.isVegetarian && dish.spicyLevel <= 0 && !dish.isHalal) return null;
  const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold';
  return (
    <ul className={clsx('flex flex-wrap gap-1.5', className)}>
      {dish.isVegetarian ? (
        <li className={clsx(pill, 'bg-steppe-100 text-steppe-700')}>
          <LeafIcon size={14} />
          {labels.vegetarian}
        </li>
      ) : null}
      {dish.spicyLevel > 0 ? (
        <li className={clsx(pill, 'bg-terracotta-500/10 text-terracotta-600')} title={labels.spicyLevel}>
          <span className="inline-flex" aria-hidden="true">
            {Array.from({ length: Math.min(3, dish.spicyLevel) }, (_, i) => (
              <FlameIcon key={i} size={13} className={i > 0 ? '-ml-1' : undefined} />
            ))}
          </span>
          {labels.spicy}
          <span className="sr-only">. {labels.spicyLevel}</span>
        </li>
      ) : null}
      {dish.isHalal ? <li className={clsx(pill, 'bg-gold-200 text-gold-700')}>{labels.halal}</li> : null}
    </ul>
  );
}
