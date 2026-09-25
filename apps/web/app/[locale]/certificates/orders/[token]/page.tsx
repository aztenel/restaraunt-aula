import { notFound } from 'next/navigation';
import { redirect } from '@/i18n/navigation';
import { resolveLocale } from '@/lib/page';
import { isPublicToken } from '@/lib/payment-return';
import { routes } from '@/lib/routes';

/**
 * Синоним для ссылки возврата с оплаты, которую сейчас формирует API
 * (PaymentLinks.certificateOrderUrl → /certificates/orders/{token}) → страница заказа сертификата.
 */
export default async function CertificateOrderAlias({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const locale = await resolveLocale(params);
  const { token } = await params;
  if (!isPublicToken(token)) notFound();
  redirect({ href: routes.certificateOrder(token), locale });
}
