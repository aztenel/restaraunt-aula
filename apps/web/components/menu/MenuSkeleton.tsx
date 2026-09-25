import { Skeleton } from '@/components/ui/Skeleton';

/** Скелетон меню: те же размеры карточек, что у DishCard (нет скачка вёрстки при загрузке). */
export function MenuSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6" aria-busy="true">
      <Skeleton className="mt-6 h-4 w-40" />
      <Skeleton className="mt-6 h-9 w-1/2 max-w-sm" />
      <Skeleton className="mt-3 h-5 w-2/3 max-w-md" />
      <Skeleton className="mt-8 h-12 w-full" rounded="full" />
      <div className="mt-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 shrink-0" rounded="full" />
        ))}
      </div>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex gap-3 rounded-card border border-earth-100 bg-cream-50 p-3 sm:flex-col sm:p-0">
            <Skeleton className="aspect-square w-28 shrink-0 sm:aspect-[4/3] sm:w-full sm:rounded-none" />
            <div className="flex-1 space-y-2 sm:p-4">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <div className="flex justify-between pt-2">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-11 w-28" rounded="full" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DishSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 sm:px-6" aria-busy="true">
      <Skeleton className="mt-6 h-4 w-56" />
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        <Skeleton className="aspect-[4/3] w-full" />
        <div className="space-y-3">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-12 w-full" rounded="full" />
        </div>
      </div>
    </div>
  );
}
