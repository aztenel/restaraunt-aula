import clsx from 'clsx';

/** Заглушка загрузки (анимация отключается при prefers-reduced-motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-xl bg-earth-100/80 motion-reduce:animate-none', className)} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-card border border-earth-100 bg-cream-50 p-5 shadow-card">
      <Skeleton className="h-6 w-2/3" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-4/5" />
      <div className="mt-5 flex gap-2">
        <Skeleton className="h-11 w-28 rounded-full" />
        <Skeleton className="h-11 w-11 rounded-full" />
      </div>
    </div>
  );
}

export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6" aria-busy="true">
      <Skeleton className="h-9 w-1/2 max-w-sm" />
      <Skeleton className="mt-3 h-5 w-3/4 max-w-lg" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
