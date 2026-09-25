import { branch, createPickupOrder, createTableReservation, pickDish } from './support/api';
import { DEMO } from './support/env';
import { expect, test } from './support/fixtures';

/**
 * Метаданные проверяем глазами поискового робота: для роботов из списка htmlLimitedBots Next.js
 * отдаёт title/description/canonical/hreflang в <head> блокирующим рендером (обычным браузерам и Googlebot
 * они приходят потоком в конце документа). Яндекс — основной поисковик аудитории.
 */
const YANDEX_BOT = 'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)';

test.describe('SEO', () => {
  test.use({ userAgent: YANDEX_BOT });

  test('индексируемые страницы: уникальные title и description, canonical, hreflang kk/ru/en/x-default', async ({ page }) => {
    const b = await branch(DEMO.deliveryBranch);
    const dish = await pickDish(b.slug);
    const paths = [
      '/ru',
      `/ru/${b.slug}/menu`,
      `/ru/${b.slug}/menu/${dish.categorySlug}`,
      `/ru/${b.slug}/menu/${dish.categorySlug}/${dish.slug}`,
      '/ru/branches',
      `/ru/branches/${b.slug}`,
      '/ru/booking',
      '/ru/banquets',
      '/ru/certificates',
      '/ru/promotions',
      '/kk',
      '/en',
    ];
    const titles = new Map<string, string>();
    for (const path of paths) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      const title = await page.title();
      expect(title.trim(), `${path}: title`).not.toBe('');
      titles.set(path, title);
      await expect(page.locator('head title'), `${path}: title в <head>`).toHaveCount(1);
      await expect(page.locator('head meta[name="description"]'), path).toHaveAttribute('content', /\S.{15,}/);
      await expect(page.locator('meta[name="robots"][content*="noindex"]'), `${path} индексируется`).toHaveCount(0);
      const canonical = await page.locator('head link[rel="canonical"]').getAttribute('href');
      expect(canonical, `${path}: canonical`).toMatch(/^https?:\/\//);
      expect(new URL(canonical!).pathname.replace(/\/$/, ''), `${path}: canonical path`).toBe(path);
      for (const lang of ['kk', 'ru', 'en', 'x-default']) {
        await expect(page.locator(`head link[rel="alternate"][hreflang="${lang}"]`), `${path}: hreflang ${lang}`).toHaveCount(1);
      }
      const lang = path.split('/')[1];
      await expect(page.locator('html')).toHaveAttribute('lang', lang!);
    }
    const duplicates = [...titles].filter(([, title], i, all) => all.findIndex(([, t]) => t === title) !== i);
    expect(duplicates, 'одинаковые title').toEqual([]);
  });

  test('структурированные данные JSON-LD: главная, меню филиала, блюдо', async ({ page }) => {
    const b = await branch(DEMO.deliveryBranch);
    const dish = await pickDish(b.slug);
    const jsonLd = async (path: string) => {
      await page.goto(path);
      const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
      expect(blocks.length, `${path}: JSON-LD`).toBeGreaterThan(0);
      return blocks.map((text) => JSON.parse(text) as unknown);
    };
    const home = JSON.stringify(await jsonLd('/ru'));
    expect(home).toMatch(/"@type":"(Restaurant|Organization|WebSite)"/);
    const menu = JSON.stringify(await jsonLd(`/ru/${b.slug}/menu`));
    expect(menu).toMatch(/"@type":"(Menu|Restaurant)"/);
    const dishLd = JSON.stringify(await jsonLd(`/ru/${b.slug}/menu/${dish.categorySlug}/${dish.slug}`));
    expect(dishLd).toContain(dish.name);
  });

  test('404: неизвестные блюдо, раздел, филиал и токены', async ({ request }) => {
    const b = await branch(DEMO.deliveryBranch);
    const dish = await pickDish(b.slug);
    for (const path of [
      `/ru/${b.slug}/menu/${dish.categorySlug}/no-such-dish-e2e`,
      `/ru/${b.slug}/menu/no-such-category-e2e`,
      '/ru/no-such-branch-e2e/menu',
      '/ru/orders/NoSuchOrderToken1234567890abcd',
      '/ru/booking/NoSuchReservationToken12345678',
      '/ru/banquets/quote/NoSuchQuoteToken123456789012',
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(404);
    }
  });

  test('страницы по токену, корзина и оформление — noindex; их нет в sitemap', async ({ page, request, guest }) => {
    const order = await createPickupOrder(guest, DEMO.deliveryBranch);
    const booking = await createTableReservation(guest, DEMO.bookingBranch);
    for (const path of [`/ru/orders/${order.publicToken}`, `/ru/booking/${booking.token}`, '/ru/cart', '/ru/checkout']) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await expect(page.locator('meta[name="robots"]'), path).toHaveAttribute('content', /noindex/);
    }
    const sitemap = await (await request.get('/sitemap.xml')).text();
    expect(sitemap).toMatch(/\/ru\/booking</);
    expect(sitemap).not.toMatch(/\/orders\/|\/checkout|\/cart/);
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toMatch(/Sitemap:/i);
  });
});
