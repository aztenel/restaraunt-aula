import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ru from '@/messages/ru.json';
import { DishOrderPanel } from '@/components/menu/DishOrderPanel';
import type { ModifierGroup } from '@/lib/api-types';
import { CartProvider, createCartStore } from '@/lib/cart';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => '/greenline/menu/kazakhskaya-kukhnya/beshbarmak',
}));
vi.mock('@/lib/analytics-session', () => ({ trackStorefrontEvent: vi.fn() }));

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });
const option = (id: string, price = 0, isDefault = false) => ({ id, name: id, price: kzt(price), isDefault });

const groups: ModifierGroup[] = [
  { id: 'size', name: 'Порция', description: '', minSelect: 1, maxSelect: 1, isRequired: true, options: [option('std', 0, true), option('big', 190000)] },
  { id: 'extras', name: 'Добавки', description: '', minSelect: 0, maxSelect: 2, isRequired: false, options: [option('baursak', 70000), option('bread', 50000), option('onion', 20000)] },
  { id: 'side', name: 'Гарнир', description: '', minSelect: 1, maxSelect: 2, isRequired: true, options: [option('rice'), option('fries')] },
];

afterEach(cleanup);

function renderPanel(available = true) {
  const store = createCartStore(null);
  render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <CartProvider store={store}>
        <DishOrderPanel dishId="d1" name="Бешбармак" branchId="b1" available={available} modifierGroups={groups} />
      </CartProvider>
    </NextIntlClientProvider>,
  );
  return store;
}

describe('карточка блюда: выбор добавок', () => {
  it('показывает правила групп с сервера и доплаты опций (без расчёта итога)', () => {
    renderPanel();
    expect(screen.getByText('Обязательно, выберите один')).toBeTruthy();
    expect(screen.getByText('Необязательно, до 2')).toBeTruthy();
    expect(screen.getByText('Обязательно, от 1 до 2')).toBeTruthy();
    expect(screen.getByText('+1 900 ₸')).toBeTruthy();
    // Опция по умолчанию выбрана; одна группа — радиокнопки, другая — флажки.
    expect((screen.getByRole('radio', { name: 'std' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'std' }) as HTMLInputElement).type).toBe('radio');
    expect((screen.getByRole('checkbox', { name: /^baursak/ }) as HTMLInputElement).type).toBe('checkbox');
  });

  it('не даёт отметить больше maxSelect', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: /^baursak/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /^bread/ }));
    expect((screen.getByRole('checkbox', { name: /^onion/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /^bread/ }));
    expect((screen.getByRole('checkbox', { name: /^onion/ }) as HTMLInputElement).disabled).toBe(false);
  });

  it('подсказывает незаполненную обязательную группу, затем кладёт в корзину только id опций и количество', () => {
    const store = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: ru.Dish.add }));
    expect(screen.getByRole('alert').textContent).toBe('Выберите вариант: «Гарнир»');
    expect(store.getSnapshot().lines).toHaveLength(0);

    fireEvent.click(screen.getByRole('checkbox', { name: /^rice/ }));
    fireEvent.click(screen.getByRole('radio', { name: /^big/ }));
    fireEvent.click(screen.getByRole('button', { name: ru.Dish.increase }));
    fireEvent.click(screen.getByRole('button', { name: ru.Dish.add }));

    const lines = store.getSnapshot().lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ dishId: 'd1', quantity: 2, modifierOptionIds: ['big', 'rice'] });
    expect(store.getSnapshot().branchId).toBe('b1');
    expect(screen.getByText(ru.Dish.goToCart)).toBeTruthy();
  });

  it('блюдо в стоп-листе: без кнопки, с пояснением', () => {
    renderPanel(false);
    expect(screen.queryByRole('button', { name: ru.Dish.add })).toBeNull();
    expect(screen.getByText(ru.Dish.unavailableText, { exact: false })).toBeTruthy();
  });
});
