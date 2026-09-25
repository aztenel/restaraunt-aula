/**
 * Шаги сценариев на витрине (русская версия; тексты — из словарей витрины).
 */
import { expect, type Page } from '@playwright/test';
import type { PickedDish } from './api';
import type { Guest } from './guest';
import { escapeRegExp, msg, msgPrefix } from './messages';

/** Страница оплаты песочницы API (/api/v1/public/payments/sandbox/:id): «Оплатить» или «Отказ». */
export async function payInSandbox(page: Page, result: 'succeeded' | 'failed' = 'succeeded'): Promise<void> {
  await page.waitForURL(/\/public\/payments\/sandbox\//, { timeout: 45_000 });
  await page.getByRole('button', { name: result === 'succeeded' ? 'Оплатить' : 'Отказ', exact: true }).click();
}

/** Блюдо в корзину со страницы блюда (без обязательных добавок). */
export async function addDishToCart(page: Page, branchSlug: string, dish: PickedDish, quantity = 1): Promise<void> {
  await page.goto(`/ru/${branchSlug}/menu/${dish.categorySlug}/${dish.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: dish.name })).toBeVisible();
  for (let i = 1; i < quantity; i++) await page.getByRole('button', { name: msg('Dish.increase') }).click();
  await page.getByRole('button', { name: msg('Dish.add'), exact: true }).click();
  await expect(page.getByText(msg('Dish.addedAnnounce', { name: dish.name })).first()).toBeAttached();
}

/** Корзина → «Оформить заказ» (сумма в корзине — из расчёта сервера). */
export async function openCheckout(page: Page): Promise<void> {
  await page.goto('/ru/cart');
  await expect(page.getByText(msg('Cart.total'), { exact: true }).first()).toBeVisible();
  await page.getByRole('link', { name: msg('Cart.checkout') }).click();
  await page.waitForURL(/\/ru\/checkout/);
}

/** Выбор карточки-переключателя (radio внутри label, возможно визуально скрытый); RegExp — если в подписи есть подсказка. */
export async function chooseRadioCard(page: Page, name: string | RegExp): Promise<void> {
  const radio = typeof name === 'string' ? page.getByRole('radio', { name, exact: true }) : page.getByRole('radio', { name });
  await page.locator('label').filter({ has: radio }).click();
  await expect(radio).toBeChecked();
}

export async function acceptPersonalDataConsent(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: new RegExp(escapeRegExp(msgPrefix('Forms.consentPersonalData').replace(/\s*—$/, ''))) }).check();
}

export async function fillCheckoutContacts(page: Page, guest: Guest): Promise<void> {
  await page.getByLabel(msg('Checkout.name'), { exact: true }).fill(guest.name);
  await page.getByLabel(msg('Checkout.phone'), { exact: true }).fill(guest.phone);
  await acceptPersonalDataConsent(page);
}

/**
 * Точка доставки: клик по карте внутри зоны доставки филиала. Зоны — полигоны Leaflet (SVG path):
 * ищем ближайшую к центру видимую точку, где под курсором полигон зоны (не шапка и не нижнее меню).
 */
export async function clickInsideDeliveryZone(page: Page): Promise<void> {
  const map = page.locator('.leaflet-container');
  await expect(map.locator('path.leaflet-interactive').first()).toBeAttached();
  await map.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const point = await map.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const candidates: Array<[number, number]> = [];
    for (let y = r.top + 12; y <= r.bottom - 12; y += 6) for (let x = r.left + 12; x <= r.right - 12; x += 6) candidates.push([x, y]);
    candidates.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
    for (const [x, y] of candidates) {
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit) && hit.tagName.toLowerCase() === 'path' && hit.classList.contains('leaflet-interactive')) return { x, y };
    }
    return null;
  });
  if (!point) throw new Error('Зона доставки не видна на карте');
  await page.mouse.click(point.x, point.y);
}

/** После выбора точки: «Доставим из филиала …» или предложение сменить филиал (подтверждаем). */
export async function confirmDeliverable(page: Page): Promise<void> {
  const deliverable = page.getByText(new RegExp(escapeRegExp(msgPrefix('Checkout.address.deliverable'))));
  const switchTitle = page.getByText(new RegExp(escapeRegExp(msgPrefix('Checkout.address.switchTitle'))));
  await expect(deliverable.or(switchTitle).first()).toBeVisible();
  if (await switchTitle.isVisible()) {
    await page.getByRole('button', { name: new RegExp(`^${escapeRegExp(msgPrefix('Checkout.address.switchConfirm'))}`) }).click();
    await expect(deliverable.first()).toBeVisible();
  }
}

/** Цифры суммы («7 930 ₸» → «7930») — сравнение с суммой API в тиынах без арифметики на витрине. */
export function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

export function tengeDigits(amountTiyn: number): string {
  const tenge = Math.trunc(amountTiyn / 100);
  const rest = amountTiyn % 100;
  return rest === 0 ? String(tenge) : `${tenge}${String(rest).padStart(2, '0')}`;
}
