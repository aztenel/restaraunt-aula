import { branch, createPickupOrder, createTableReservation, pickDish } from './support/api';
import { DEMO } from './support/env';
import { expect, test } from './support/fixtures';
import { LOCALES, msg, RAW_KEY_RE } from './support/messages';

/**
 * Переводы: на kk/ru/en нет «сырых» ключей словаря (next-intl показывает Namespace.key, если перевода
 * нет), язык страницы и заголовок на месте — включая клиентские части (корзина, оформление, поиск брони).
 */
test('kk/ru/en: страницы без сырых ключей сообщений', async ({ page, guest }) => {
  test.setTimeout(240_000);
  const b = await branch(DEMO.deliveryBranch);
  const dish = await pickDish(b.slug);
  const order = await createPickupOrder(guest, DEMO.deliveryBranch);
  const booking = await createTableReservation(guest, DEMO.bookingBranch);
  // Корзина с одним блюдом — чтобы отрисовались корзина и первый экран оформления.
  await page.addInitScript(
    ([branchId, dishId]) => {
      window.localStorage.setItem(
        'aula_cart_v1',
        JSON.stringify({ version: 1, branchId, lines: [{ key: `${dishId}|`, dishId, modifierOptionIds: [], quantity: 1 }], updatedAt: new Date().toISOString() }),
      );
    },
    [b.id, dish.id] as const,
  );

  const paths = [
    '',
    `/${b.slug}/menu`,
    `/${b.slug}/menu/${dish.categorySlug}/${dish.slug}`,
    '/branches',
    '/cart',
    '/checkout',
    `/booking?branch=${DEMO.bookingBranch}`,
    '/banquets',
    '/certificates',
    '/promotions',
    `/orders/${order.publicToken}`,
    `/booking/${booking.token}`,
  ];

  for (const locale of LOCALES) {
    for (const path of paths) {
      await test.step(`${locale}${path}`, async () => {
        const response = await page.goto(`/${locale}${path}`);
        expect(response?.status()).toBe(200);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('h1').first()).not.toBeEmpty();
        // Клиентские компоненты дорисовались (скелетоны сменились содержимым).
        await page.waitForLoadState('networkidle');
        const text = await page.locator('body').innerText();
        expect(text.match(RAW_KEY_RE)?.[0] ?? null, `сырой ключ на /${locale}${path}`).toBeNull();
      });
    }

    await test.step(`${locale}: поиск брони (клиентские сообщения)`, async () => {
      await page.goto(`/${locale}/booking?branch=${DEMO.bookingBranch}`);
      await page.getByRole('button', { name: msg('Booking.search', {}, locale) }).click();
      await expect(
        page.getByRole('radiogroup').or(page.getByText(msg('Booking.noVenuesTitle', {}, locale))).first(),
      ).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text.match(RAW_KEY_RE)?.[0] ?? null).toBeNull();
    });
  }
});
