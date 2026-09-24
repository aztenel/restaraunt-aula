import { PageSkeleton } from '@/components/ui/Skeleton';

/*
 * Скелетон главной. loading.tsx создаёт границу Suspense: всё, что внутри, отдаётся потоком
 * ПОСЛЕ отправки заголовков, поэтому notFound()/redirect() внутри уже не меняют HTTP-статус.
 * Поэтому скелетоны — только в группах маршрутов без 404/редиректов, а проверки существования
 * (филиал, категория, блюдо) — в layout.tsx выше границы (см. [branchSlug]/menu/layout.tsx).
 */
export default function Loading() {
  return <PageSkeleton cards={2} />;
}
