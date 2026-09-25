import { issueIndividualInvoice, sendBanquetQuote } from './support/api';
import { OWNER } from './support/env';
import { expect, test } from './support/fixtures';
import { localDate } from './support/guest';
import { escapeRegExp, msg, msgPrefix } from './support/messages';
import { acceptPersonalDataConsent, payInSandbox } from './support/ui';

test('банкет: заявка → смета (админ-API) → согласование по ссылке → счёт → онлайн-оплата', async ({ page, guest }) => {
  test.skip(!OWNER.password, 'нужен пароль собственника из сида: E2E_OWNER_PASSWORD / SEED_OWNER_PASSWORD');

  const number = await test.step('заявка на странице банкетов (формат из ссылки)', async () => {
    await page.goto('/ru/banquets?type=kudalyk#banquet-request');
    await expect(page.getByLabel(msg('Banquets.form.eventType'))).toHaveValue('kudalyk');
    await page.getByLabel(msg('Banquets.form.eventDate'), { exact: true }).fill(localDate(45));
    await page.getByLabel(new RegExp(`^${escapeRegExp(msg('Banquets.form.eventTime'))}`)).fill('18:00');
    await page.getByLabel(msg('Banquets.form.guests'), { exact: true }).fill('40');
    await page.getByLabel(new RegExp(escapeRegExp(msg('Banquets.form.budget')))).fill('2 000 000');
    await page.getByLabel(msg('Banquets.form.name'), { exact: true }).fill(guest.name);
    await page.getByLabel(msg('Banquets.form.phone'), { exact: true }).fill(guest.phone);
    await acceptPersonalDataConsent(page);
    await page.getByRole('button', { name: msg('Banquets.form.submit') }).click();
    const done = page.getByRole('status').filter({ hasText: msgPrefix('Banquets.form.doneTitle') });
    await expect(done).toBeVisible();
    const text = (await done.textContent()) ?? '';
    const found = text.match(/№\s*(\S+)/)?.[1];
    expect(found, 'номер заявки на экране «спасибо»').toBeTruthy();
    return found!;
  });

  const quote = await test.step('менеджер отправляет смету (админ-API)', () => sendBanquetQuote(number));
  expect(new URL(quote.url).pathname, 'ссылка из API ведёт на страницу витрины').toBe(`/ru/banquets/quote/${quote.token}`);

  await test.step('страница сметы: позиции, итоги, НДС, PDF → согласование', async () => {
    await page.goto(`/ru/banquets/quote/${quote.token}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(number);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.getByText('Аренда зала')).toBeVisible();
    await expect(page.getByText(msg('BanquetQuote.total'), { exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`${escapeRegExp(msgPrefix('BanquetQuote.vatIncluded'))}|${escapeRegExp(msg('BanquetQuote.vatNone'))}`))).toBeVisible();
    await expect(page.getByRole('link', { name: msg('BanquetQuote.pdf') })).toHaveAttribute('href', /^https?:\/\//);
    await page.getByRole('button', { name: msg('BanquetQuote.accept') }).click();
    await page.getByRole('button', { name: msg('BanquetQuote.confirm') }).click();
    await expect(page.getByText(msg('BanquetQuote.acceptedTitle'))).toBeVisible();
    await expect(page.getByText(new RegExp(escapeRegExp(msgPrefix('BanquetQuote.acceptedPrepayment'))))).toBeVisible();
  });

  const invoice = await test.step('менеджер выставляет счёт физлицу (админ-API)', () => issueIndividualInvoice(quote.requestId));
  expect(new URL(invoice.url).pathname).toBe(`/ru/banquets/invoice/${invoice.token}`);

  await test.step('страница счёта → оплата в песочнице → оплачен', async () => {
    await page.goto(`/ru/banquets/invoice/${invoice.token}`);
    await expect(page.getByRole('heading', { level: 2, name: msg('BanquetInvoice.status.issued') })).toBeVisible();
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msgPrefix('BanquetInvoice.pay'))}`) }).click();
    await payInSandbox(page);
    await page.waitForURL(new RegExp(`/ru/banquets/invoice/${invoice.token}$`));
    await expect(page.getByText(msg('BanquetInvoice.paidText'))).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: msg('BanquetInvoice.status.paid') })).toBeVisible();
  });
});
