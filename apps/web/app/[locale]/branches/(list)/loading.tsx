import { PageSkeleton } from '@/components/ui/Skeleton';

/** Скелетон списка филиалов (группа (list) — не оборачивает страницу филиала, где нужен настоящий 404). */
export default function Loading() {
  return <PageSkeleton cards={2} />;
}
