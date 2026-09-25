import { apiLogSize, branch, orderTracking, pickDish, waitForSmsCode } from './support/api';
import { API_LOG, DEMO } from './support/env';
import { expect, test } from './support/fixtures';
import { escapeRegExp, msg, msgPrefix } from './support/messages';
import { addDishToCart, chooseRadioCard, fillCheckoutContacts, openCheckout, payInSandbox } from './support/ui';

test.describe('самовывоз', () => {
  test('оплата при получении: ко времени, подтверждение телефона SMS-кодом → заказ оформлен', async ({ page, guest }) => {
    test.skip(!API_LOG, 'нужен E2E_API_LOG — журнал API с кодами SMS (e2e/stack.md)');
    const b = await branch(DEMO.bookingBranch);
    test.skip(!b.paymentMethods.includes('on_receipt'), 'филиал не принимает оплату при получении');
    const dish = await pickDish(b.slug);

    await addDishToCart(page, b.slug, dish);
    await openCheckout(page);
    await chooseRadioCard(page, msg('Checkout.pickup'));
    await page.getByRole('radio', { name: new RegExp(`^${escapeRegExp(b.name)}`) }).check();

    await test.step('ко времени: ближайший слот филиала', async () => {
      await page.getByRole('radio', { name: msg('Checkout.time.scheduled') }).check();
      const slot = page.getByLabel(msg('Checkout.time.slot'), { exact: true });
      await expect(slot.locator('option').nth(1)).toBeAttached();
      await slot.selectOption({ index: 1 });
    });

    await fillCheckoutContacts(page, guest);
    await page.getByRole('button', { name: msg('Checkout.toPayment') }).click();
    await expect(page).toHaveURL(/step=payment/);
    await chooseRadioCard(page, new RegExp(`^${escapeRegExp(msg('Checkout.payOnReceipt'))}`));

    const submit = page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msg('Checkout.submitOnReceipt'))}`) });
    await test.step('сервер требует подтвердить телефон', async () => {
      await submit.click();
      await expect(page.getByText(msg('Checkout.verificationRequired')).first()).toBeVisible();
      await expect(page).toHaveURL(/step=payment/);
    });

    await test.step('код из SMS (канал log API) → телефон подтверждён', async () => {
      const logOffset = apiLogSize();
      await page.getByRole('button', { name: msg('PhoneVerification.send') }).click();
      const code = await waitForSmsCode(guest.phone, { after: logOffset });
      await page.getByRole('textbox', { name: new RegExp(escapeRegExp(msgPrefix('PhoneVerification.codeLabel'))) }).fill(code);
      await page.getByRole('button', { name: msg('PhoneVerification.verify') }).click();
      await expect(page.getByText(new RegExp(escapeRegExp(msgPrefix('PhoneVerification.verified')))).first()).toBeVisible();
    });

    await submit.click();
    await page.waitForURL(/\/ru\/orders\/[^/?]+$/);
    const token = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.locator('h2').first()).toHaveText(msg('Order.statusPlaced'));
    const tracking = await orderTracking(token);
    expect(tracking).toMatchObject({ type: 'pickup', payment: { method: 'on_receipt' } });
    expect(tracking.scheduledFor).not.toBeNull();
    await expect(page.getByText(msg('Order.payOnReceipt'))).toBeVisible();
  });

  test('онлайн-оплата: отказ в песочнице → «Оплатить снова» → новая попытка оплачена', async ({ page, guest }) => {
    const b = await branch(DEMO.deliveryBranch);
    const dish = await pickDish(b.slug, { skip: 1 });

    await addDishToCart(page, b.slug, dish);
    await openCheckout(page);
    await chooseRadioCard(page, msg('Checkout.pickup'));
    await fillCheckoutContacts(page, guest);
    await page.getByRole('button', { name: msg('Checkout.toPayment') }).click();
    await chooseRadioCard(page, new RegExp(`^${escapeRegExp(msg('Checkout.payOnline'))}`));
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msg('Checkout.submitOnline'))}`) }).click();

    await payInSandbox(page, 'failed');
    await page.waitForURL(/\/ru\/orders\/[^/?]+$/);
    const token = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByText(msg('Order.paymentFailed'))).toBeVisible();
    const first = (await orderTracking(token)).payment.current?.id;

    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msgPrefix('Order.retryPayment'))}`) }).click();
    await payInSandbox(page, 'succeeded');
    await page.waitForURL(new RegExp(`/ru/orders/${token}$`));
    await expect(page.locator('h2').first()).toHaveText(new RegExp(`${msg('Order.status.paid')}|${msg('Order.status.accepted')}`));
    const tracking = await orderTracking(token);
    expect(tracking.payment.isPaid).toBe(true);
    expect(tracking.payment.current?.id).not.toBe(first);
  });
});
