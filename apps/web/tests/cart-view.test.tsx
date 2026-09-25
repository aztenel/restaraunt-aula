import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@aula/api-client';
import ru from '@/messages/ru.json';
import { CartView, type CartBranchOption } from '@/components/cart/CartView';
import { CartProvider, createCartStore } from '@/lib/cart';
import { QUOTE_PATH } from '@/lib/ordering';

const api = vi.hoisted(() => ({ raw: vi.fn(), GET: vi.fn() }));

vi.mock('@/lib/api', () => ({ getBrowserApi: () => api }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/cart',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

const kzt = (amount: number) => ({ amount, currency: 'KZT' });

const branches: CartBranchOption[] = [
  { id: 'b1', slug: 'greenline', name: 'AULA GreenLine Aqua', acceptsDelivery: true, acceptsPickup: true },
  { id: 'b2', slug: 'garden-view', name: 'AULA Garden View', acceptsDelivery: false, acceptsPickup: true },
];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function renderCart() {
  const store = createCartStore(memoryStorage());
  store.dispatch({ type: 'add', dishId: 'd1', branchId: 'b1', quantity: 2, modifierOptionIds: ['m-big'] });
  store.dispatch({ type: 'add', dishId: 'd2', quantity: 1 });
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <CartProvider store={store}>
        <CartView branches={branches} />
      </CartProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

const quote = {
  branchId: 'b1',
  type: 'pickup',
  lines: [
    {
      index: 0,
      dishId: 'd1',
      name: 'Бешбармак',
      photoUrl: null,
      quantity: 2,
      unitPrice: kzt(520000),
      lineTotal: kzt(1040000),
      modifiers: [{ groupId: 'g', groupName: 'Порция', optionId: 'm-big', name: 'Большая', price: kzt(70000) }],
      available: true,
      problem: null,
    },
    // Недоступная позиция приходит без названия — витрина берёт подпись из меню филиала.
    { index: 1, dishId: 'd2', name: null, photoUrl: null, quantity: 1, unitPrice: null, lineTotal: null, modifiers: [], available: false, problem: 'catalog.dish_unavailable' },
  ],
  subtotal: kzt(1040000),
  discount: kzt(0),
  deliveryFee: kzt(0),
  total: kzt(1040000),
  amountDue: kzt(1040000),
  delivery: null,
  promo: null,
  certificate: null,
  problems: ['catalog.dish_unavailable'],
  canCheckout: false,
};

beforeEach(() => {
  api.raw.mockReset();
  api.GET.mockReset();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('корзина: суммы только с сервера', () => {
  it('показывает названия, добавки, суммы из расчёта и проблему недоступной позиции', async () => {
    api.raw.mockResolvedValue(quote);
    api.GET.mockResolvedValue({
      data: { categories: [{ dishes: [{ id: 'd2', name: 'Казы', photo: null }] }] },
      response: new Response(null, { status: 200 }),
    });
    renderCart();

    expect(await screen.findByText('Бешбармак')).toBeTruthy();
    expect(await screen.findByText('Казы')).toBeTruthy();
    expect(screen.getByText('Большая')).toBeTruthy();
    // Итог — ровно то, что прислал сервер (10 400 ₸), клиент не складывает цены.
    // (Testing Library сводит неразрывные пробелы форматирования к обычным.)
    const total = '10 400 ₸';
    expect(screen.getAllByText(total).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Блюдо закончилось в этом филиале/)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(ru.Cart.fixLines);
    // Оформление недоступно, пока в корзине есть недоступная позиция.
    const checkout = screen.getByRole('button', { name: ru.Cart.checkout }) as HTMLButtonElement;
    expect(checkout.disabled).toBe(true);

    expect(api.raw).toHaveBeenCalledWith(
      'POST',
      QUOTE_PATH,
      expect.objectContaining({
        query: { locale: 'ru' },
        body: {
          branchId: 'b1',
          type: 'pickup',
          items: [
            { dishId: 'd1', quantity: 2, modifierOptionIds: ['m-big'] },
            { dishId: 'd2', quantity: 1, modifierOptionIds: [] },
          ],
        },
      }),
    );
  });

  it('если расчёт ещё не развёрнут (404) — позиции без сумм и понятное сообщение', async () => {
    api.raw.mockRejectedValue(new ApiError({ status: 404, code: 'http.404', message: 'Cannot POST /api/v1/public/orders/quote' }));
    api.GET.mockResolvedValue({
      data: { categories: [{ dishes: [{ id: 'd1', name: 'Бешбармак', photo: null }] }] },
      response: new Response(null, { status: 200 }),
    });
    renderCart();

    expect(await screen.findByText(ru.Cart.quoteUnavailable)).toBeTruthy();
    // Название — из меню филиала (подпись), сумм нет.
    await waitFor(() => expect(screen.getByText('Бешбармак')).toBeTruthy());
    expect(screen.queryByText(ru.Cart.total)).toBeNull();
    expect(screen.getByText(ru.Cart.dishPending)).toBeTruthy();
    // Оформление не блокируется сбоем расчёта.
    expect(screen.getByRole('link', { name: ru.Cart.checkout })).toBeTruthy();
  });

  it('сетевая ошибка — сообщение и повтор', async () => {
    api.raw.mockRejectedValue(new TypeError('Failed to fetch'));
    api.GET.mockRejectedValue(new TypeError('Failed to fetch'));
    renderCart();
    expect(await screen.findByText(ru.Cart.quoteError)).toBeTruthy();
    expect(screen.getByRole('button', { name: ru.Cart.recalculate })).toBeTruthy();
  });
});
