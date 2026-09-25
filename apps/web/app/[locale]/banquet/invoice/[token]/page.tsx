import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';

/**
 * Синоним адреса из уведомлений API (Banquet) BanquetLinks → /{locale}/banquet/invoice/{token}
 * → страница витрины routes.banquetInvoice (пока ссылки API и маршруты витрины не совпадают).
 */
export default async function LinkAlias({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  redirect({ href: routes.banquetInvoice(token), locale });
}
