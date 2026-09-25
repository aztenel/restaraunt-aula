import { branch, deliveryZones, orderTracking, pickDish } from './support/api';
import { DEMO } from './support/env';
import { expect, test } from './support/fixtures';
import { escapeRegExp, msg, msgPrefix } from './support/messages';
import {
  chooseRadioCard,
  clickInsideDeliveryZone,
  confirmDeliverable,
  digits,
  fillCheckoutContacts,
  openCheckout,
  payInSandbox,
  tengeDigits,
} from './support/ui';

test('меню → блюдо → корзина → доставка по карте → онлайн-оплата в песочнице → заказ оплачен', async ({ page, guest }) => {
  const b = await branch(DEMO.deliveryBranch);
  const dish = await pickDish(b.slug);
  const zones = await deliveryZones(b.id);
  expect(zones.length, `у филиала ${b.slug} есть зоны доставки`).toBeGreaterThan(0);
  // Сколько порций взять, чтобы пройти минимальную сумму любой зоны (выбор теста, суммы считает сервер).
  const minOrder = Math.max(...zones.map((z) => z.minOrderAmount.amount));
  const quantity = Math.min(10, Math.max(1, Math.ceil((minOrder + 1) / dish.price)));

  await test.step('меню: выбор филиала → раздел → блюдо', async () => {
    await page.goto('/ru/menu');
    await page.getByRole('link', { name: new RegExp(escapeRegExp(b.name)) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/ru/${b.slug}/menu$`));
    await page.getByRole('link', { name: msg('Menu.openCategoryAria', { name: dish.categoryName }) }).click();
    await expect(page).toHaveURL(new RegExp(`/ru/${b.slug}/menu/${dish.categorySlug}`));
    await page.getByRole('link', { name: dish.name, exact: true }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: dish.name })).toBeVisible();
  });

  await test.step(`в корзину: ${quantity} × ${dish.name}`, async () => {
    for (let i = 1; i < quantity; i++) await page.getByRole('button', { name: msg('Dish.increase') }).click();
    await page.getByRole('button', { name: msg('Dish.add'), exact: true }).click();
    await expect(page.getByText(msg('Dish.addedAnnounce', { name: dish.name })).first()).toBeAttached();
  });

  await test.step('оформление: доставка, точка на карте в зоне, контакты', async () => {
    await openCheckout(page);
    await chooseRadioCard(page, msg('Checkout.delivery'));
    await page.getByLabel(msg('Checkout.address.label'), { exact: true }).fill('ул. Кенесары, 40');
    await clickInsideDeliveryZone(page);
    await confirmDeliverable(page);
    await page.getByLabel(msg('Checkout.address.apartment')).fill('12');
    await fillCheckoutContacts(page, guest);
    await page.getByRole('button', { name: msg('Checkout.toPayment') }).click();
    await expect(page).toHaveURL(/step=payment/);
  });

  const submit = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msg('Checkout.submitOnline'))}`) });
  await test.step('оплата онлайн, промокод, сумма от сервера', async () => {
    await chooseRadioCard(page, new RegExp(`^${escapeRegExp(msg('Checkout.payOnline'))}`));
    await page.getByLabel(msg('Checkout.promo')).fill(DEMO.promoCode);
    await page.getByRole('button', { name: msg('Checkout.apply') }).first().click();
    await expect(page.getByText(msg('Checkout.promoApplied', { code: DEMO.promoCode }))).toBeVisible();
    await expect(submit).toHaveText(/·/);
  });

  const token = await test.step('оформить → статус заказа → песочница', async () => {
    const label = await submit.textContent();
    await submit.click();
    await page.waitForURL(/\/ru\/orders\/[^/?]+\?pay=1/);
    const token = new URL(page.url()).pathname.split('/').pop()!;
    const tracking = await orderTracking(token);
    // Сумма на кнопке = сумма к оплате, рассчитанная сервером.
    expect(digits(label)).toContain(tengeDigits(tracking.payment.amountDue.amount));
    expect(tracking.discount.amount).toBeGreaterThan(0);
    await payInSandbox(page);
    return token;
  });

  await test.step('возврат с оплаты: статус обновляется опросом, корзина пуста', async () => {
    await page.waitForURL(new RegExp(`/ru/orders/${token}$`));
    await expect(page.locator('h2').first()).toHaveText(new RegExp(`${msg('Order.status.paid')}|${msg('Order.status.accepted')}|${msg('Order.status.cooking')}`));
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
    const tracking = await orderTracking(token);
    expect(tracking.payment.isPaid).toBe(true);
    expect(tracking.type).toBe('delivery');
    await expect(page.getByText(new RegExp(escapeRegExp(msgPrefix('Order.number')))).first()).toContainText(tracking.number);
    const cart = await page.evaluate(() => JSON.parse(window.localStorage.getItem('aula_cart_v1') ?? '{"lines":[]}') as { lines: unknown[] });
    expect(cart.lines).toEqual([]);
  });
});
