import { notFound } from 'next/navigation';
import { resolveLocale } from '@/lib/page';

type Params = Promise<{ locale: string; branchSlug: string; rest: string[] }>;

/**
 * Любой неизвестный адрес внутри языкового раздела → локализованная страница 404
 * (с шапкой, подвалом и навигацией), а не корневая.
 */
export default async function CatchAllNotFound({ params }: { params: Params }) {
  await resolveLocale(params);
  notFound();
}
