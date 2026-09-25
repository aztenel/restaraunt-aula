// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import type * as ApiModule from '../api';
import type { AdminOrderDetails } from '../types';
import { CancelOrderDialog } from './CancelOrderDialog';

const api = { get: vi.fn(), reject: vi.fn(), cancel: vi.fn() };
const permissions = new Set<string>();

vi.mock('@/shared/auth/useCan', () => ({
  useCan: () => ({ can: (permission: string) => permissions.has(permission) }),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    ordersApi: {
      ...actual.ordersApi,
      get: (...args: unknown[]) => api.get(...args),
      reject: (...args: unknown[]) => api.reject(...args),
      cancel: (...args: unknown[]) => api.cancel(...args),
    },
  };
});

beforeAll(async () => {
  // Тяжёлые компоненты antd при параллельном прогоне всего набора тестов рендерятся медленно.
  configure({ asyncUtilTimeout: 5000 });
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element) => getComputedStyle(elt)) as typeof window.getComputedStyle;
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  api.get.mockReset();
  api.reject.mockReset();
  api.cancel.mockReset();
  permissions.clear();
});

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <App>{children}</App>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const paidOrder = {
  id: 'o1',
  number: 'GL-2026-000200',
  branchId: 'b1',
  status: 'paid',
  wasPaid: true,
  canReject: true,
  canCancel: false,
  refundable: { amount: 900_000, currency: 'KZT' },
} as unknown as AdminOrderDetails;

describe('диалог отказа / отмены', { timeout: 30_000 }, () => {
  it('режим — из флагов сервера; причина обязательна; тело запроса без частичной суммы', async () => {
    api.get.mockResolvedValue(paidOrder);
    api.reject.mockResolvedValue({ ...paidOrder, status: 'cancelled' });
    const onClose = vi.fn();
    wrap(<CancelOrderDialog orderId="o1" preferred="cancel" onClose={onClose} />);

    await waitFor(() => expect(screen.getByText('Отказ от заказа GL-2026-000200')).toBeTruthy());
    expect(screen.queryByText('Не оплачен вовремя')).toBeNull();
    expect(screen.queryByText('Вернуть не всю сумму')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Отказать' }));
    await waitFor(() => expect(screen.getByText('Выберите причину')).toBeTruthy());
    expect(api.reject).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Закончились продукты или блюда'));
    fireEvent.click(screen.getByRole('button', { name: 'Отказать' }));
    await waitFor(() => expect(api.reject).toHaveBeenCalledWith('o1', { reasonCode: 'out_of_stock', reason: null, refundAmount: null }));
    await waitFor(() => expect(onClose).toHaveBeenCalledWith(true));
  });

  it('с правом orders.refund можно вернуть часть суммы', async () => {
    permissions.add('orders.refund');
    api.get.mockResolvedValue(paidOrder);
    api.reject.mockResolvedValue(paidOrder);
    wrap(<CancelOrderDialog orderId="o1" onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText('Вернуть не всю сумму')).toBeTruthy());
    fireEvent.click(screen.getByText('Вернуть не всю сумму'));
    fireEvent.click(screen.getByText('Другая причина'));
    fireEvent.change(screen.getByLabelText('Комментарий'), { target: { value: 'Гость забрал часть заказа' } });
    const amount = await screen.findByLabelText('Сумма возврата');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '9001' } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole('button', { name: 'Отказать' }));
    await waitFor(() => expect(screen.getByText('Больше, чем можно вернуть')).toBeTruthy());
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '2500' } });
    fireEvent.blur(amount);
    fireEvent.click(screen.getByRole('button', { name: 'Отказать' }));
    await waitFor(() =>
      expect(api.reject).toHaveBeenCalledWith('o1', {
        reasonCode: 'other',
        reason: 'Гость забрал часть заказа',
        refundAmount: { amount: 250_000, currency: 'KZT' },
      }),
    );
  });

  it('сервер не разрешает ни отказ, ни отмену — сообщение вместо формы', async () => {
    api.get.mockResolvedValue({ ...paidOrder, status: 'cooking', canReject: false, canCancel: false });
    wrap(<CancelOrderDialog orderId="o1" onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByText(/Действие недоступно/)).toBeTruthy());
  });
});
