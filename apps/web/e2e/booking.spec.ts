import type { Availability } from '../lib/api-types';
import { api, branch, depositVenue, reservation } from './support/api';
import { DEMO } from './support/env';
import { expect, test } from './support/fixtures';
import { localDate } from './support/guest';
import { escapeRegExp, msg, msgPrefix } from './support/messages';
import { acceptPersonalDataConsent, payInSandbox } from './support/ui';

const TIME = '19:00';

test('бронь VIP с депозитом: поиск → выбор на схеме зала → оплата депозита → подтверждена → отмена с возвратом', async ({ page, guest }) => {
  const b = await branch(DEMO.bookingBranch);
  const venue = await depositVenue(b.slug);
  const guests = venue.capacityMin;

  // Дата, на которую место свободно (ищем вперёд: стенд переиспользуется между запусками).
  const date = await test.step('свободная дата для места', async () => {
    const start = 3 + Math.floor(Math.random() * 20);
    for (let offset = start; offset < start + 30; offset++) {
      const day = localDate(offset);
      const a = await api<Availability>(
        `/public/branches/${b.slug}/reservation-availability?date=${day}&time=${TIME}&guests=${guests}&typeCode=${venue.typeCode}&locale=ru`,
        { ip: guest.ip },
      );
      if (a.venues.some((v) => v.venueId === venue.id)) return day;
    }
    throw new Error(`${venue.name} is not free at ${TIME} in the next 30 days`);
  });

  await test.step('поиск свободных мест', async () => {
    await page.goto(`/ru/booking?branch=${b.slug}`);
    await page.getByLabel(msg('Booking.date'), { exact: true }).fill(date);
    await page.getByLabel(msg('Booking.time'), { exact: true }).selectOption(TIME);
    await page.getByLabel(msg('Booking.guests'), { exact: true }).fill(String(guests));
    await page.getByLabel(new RegExp(escapeRegExp(msg('Booking.venueType')))).selectOption({ label: venue.typeName });
    await page.getByRole('button', { name: msg('Booking.search') }).click();
  });

  const card = page.getByRole('radio', { name: new RegExp(escapeRegExp(venue.name)) });
  await test.step('место на схеме зала и в списке: депозит от сервера', async () => {
    await expect(card).toBeVisible();
    await expect(card).toContainText(msgPrefix('Booking.deposit'));
    await page.getByRole('button', { name: msg('Booking.map.show') }).click();
    await page.locator(`g[role="button"][aria-label^="${venue.name.replace(/"/g, '\\"')}"]`).click();
    await expect(card).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: msg('Booking.continue') }).click();
  });

  await test.step('контакты и согласие → бронь', async () => {
    await page.getByLabel(msg('Booking.name'), { exact: true }).fill(guest.name);
    await page.getByLabel(msg('Booking.phone'), { exact: true }).fill(guest.phone);
    await page.getByLabel(new RegExp(escapeRegExp(msg('Booking.occasion')))).fill('Юбилей');
    await acceptPersonalDataConsent(page);
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msgPrefix('Booking.submitDeposit'))}`) }).click();
    await page.waitForURL(/\/ru\/booking\/[^/?]+\?pay=1/);
  });

  const token = new URL(page.url()).pathname.split('/').pop()!;
  await test.step('оплата депозита → бронь подтверждена', async () => {
    await payInSandbox(page);
    await page.waitForURL(new RegExp(`/ru/booking/${token}$`));
    await expect(page.getByRole('heading', { name: msg('BookingStatus.phase.confirmed') })).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute('content', /noindex/);
    const r = await reservation(token);
    expect(r).toMatchObject({ status: 'confirmed', venue: { id: venue.id }, guests, date, time: TIME, deposit: { state: 'paid' } });
  });

  await test.step('отмена: правила депозита показаны, депозит возвращается', async () => {
    await page.getByRole('button', { name: msg('BookingStatus.cancelOpen') }).click();
    await expect(page.getByText(new RegExp(escapeRegExp(msgPrefix('BookingStatus.cancelOutcome.refunded'))))).toBeVisible();
    await page.getByLabel(new RegExp(escapeRegExp(msg('BookingStatus.cancelReasonLabel')))).fill('Планы изменились');
    await page.getByRole('button', { name: msg('BookingStatus.cancelConfirm') }).click();
    await expect(page.getByRole('heading', { name: msg('BookingStatus.phase.cancelled') })).toBeVisible();
    const r = await reservation(token);
    expect(r.status).toBe('cancelled');
    expect(r.deposit?.outcome).toBe('refunded');
  });
});
