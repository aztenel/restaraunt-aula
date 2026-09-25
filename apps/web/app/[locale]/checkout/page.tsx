import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CheckoutSteps } from '@/components/placeholders/CheckoutSteps';
import { PlaceholderPage } from '@/components/placeholders/PlaceholderPage';
import { getPublicBranches } from '@/lib/data';
import { resolveLocale, type LocaleParams } from '@/lib/page';
import { routes } from '@/lib/routes';
import { buildMetadata } from '@/lib/seo';

/*
 * TODO(ordering): оформление заказа — не больше 4 экранов: корзина → данные → оплата → статус.
 *   Экран «данные»: тип (доставка/самовывоз), адрес + точка на карте (филиал по адресу выбирает сервер),
 *     время «как можно скорее» или к времени, контакты, комментарий, бесконтактная доставка,
 *     согласие на обработку ПД (текст/версия — GET /api/v1/public/consents/personal_data, реализовано).
 *   Экран «оплата»: способ (branch.paymentMethods), промокод, сертификат, SMS-код при необходимости:
 *     POST /api/v1/public/phone-verifications { phone } → { verificationId, resendAfterSeconds }
 *     POST /api/v1/public/phone-verifications/{id}/verify { code } → { token }
 *   Расчёт: POST /api/v1/public/orders/quote (все суммы — от сервера).
 *   Создание: POST /api/v1/public/orders { ..., items: toQuoteLines(cart), analyticsSessionId: getAnalyticsSessionId(),
 *     idempotencyKey } → { publicToken, paymentUrl? } → редирект на оплату или /orders/{publicToken}.
 *   Цели: reachGoal(Goals.BeginCheckout) при входе, reachGoal(Goals.Purchase, analyticsValue(total)) после оплаты.
 */
export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = await getTranslations({ locale, namespace: 'Checkout' });
  return buildMetadata({ locale, path: routes.checkout(), title: t('title'), description: t('metaDescription'), noindex: true });
}

export default async function CheckoutPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = await getTranslations('Checkout');
  const branches = await getPublicBranches(locale);
  return (
    <PlaceholderPage
      locale={locale}
      title={t('title')}
      placeholderTitle={t('placeholderTitle')}
      placeholderText={t('placeholderText')}
      contacts={branches.ok ? { branches: branches.branches, whatsappText: t('whatsappText') } : undefined}
    >
      <CheckoutSteps current="details" />
    </PlaceholderPage>
  );
}
