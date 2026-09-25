import type { CertificateProduct } from '../lib/api-types';
import { api } from './support/api';
import { expect, test } from './support/fixtures';
import { escapeRegExp, msg } from './support/messages';
import { payInSandbox } from './support/ui';

test('подарочный сертификат: выбор → данные покупателя и получателя → оплата в песочнице → выпущен', async ({ page, guest }) => {
  const products = await api<CertificateProduct[]>('/public/certificates/products?locale=ru');
  const product = products[0];
  expect(product, 'в демо-сиде есть сертификаты в продаже').toBeTruthy();

  await page.goto('/ru/certificates');
  await page.getByRole('radio', { name: product!.name }).check();
  await page.getByLabel(msg('CertificateForm.buyerName'), { exact: true }).fill(guest.name);
  await page.getByLabel(msg('CertificateForm.buyerPhone'), { exact: true }).fill(guest.phone);
  await page.getByLabel(msg('CertificateForm.buyerEmail'), { exact: true }).fill(guest.email);
  await page.getByLabel(msg('CertificateForm.recipientName'), { exact: true }).fill('Айгуль');
  await page.getByRole('checkbox', { name: new RegExp(`^${escapeRegExp(msg('CertificateForm.consent'))}`) }).check();
  await page.getByRole('button', { name: msg('CertificateForm.submit') }).click();

  await page.waitForURL(/\/ru\/certificates\/order\/[^/?]+\?pay=1/);
  const token = new URL(page.url()).pathname.split('/').pop()!;
  await payInSandbox(page);
  await page.waitForURL(new RegExp(`/ru/certificates/order/${token}$`));
  await expect(page.getByRole('heading', { name: msg('CertificateOrder.issuedTitle') })).toBeVisible();
  await expect(page.getByText(msg('CertificateOrder.codeNote'))).toBeVisible();
  await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
});
