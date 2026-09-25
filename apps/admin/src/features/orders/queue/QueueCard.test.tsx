// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import type * as ApiModule from '../api';
import type { QueueOrder } from '../types';
import { QueueCard } from './QueueCard';

const transition = vi.fn();
const getOrder = vi.fn();

vi.mock('@/shared/branch/BranchProvider', () => ({
  useBranch: () => ({ branchName: (id: string) => `Филиал ${id}` }),
}));

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    ordersApi: { ...actual.ordersApi, transition: (...args: unknown[]) => transition(...args), get: (...args: unknown[]) => getOrder(...args) },
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
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  transition.mockReset();
  getOrder.mockReset();
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

const order: QueueOrder = {
  id: 'o1',
  number: 'GL-2026-000123',
  branchId: 'b1',
  type: 'pickup',
  channel: 'admin',
  status: 'paid',
  customer: { customerId: null, name: 'Айгерим', phone: '+77771234567', email: null },
  total: { amount: 1_250_000, currency: 'KZT' },
  paymentMethod: 'online',
  promoCode: null,
  placedAt: '2026-09-25T10:00:00.000Z',
  scheduledFor: '2026-09-25T14:30:00.000Z',
  promisedAt: '2026-09-25T14:30:00.000Z',
  items: [
    {
      id: 'i1',
      position: 1,
      dishId: 'd1',
      sku: null,
      name: { ru: 'Плов', kk: 'Палау' },
      photoUrl: null,
      weightGrams: 350,
      quantity: 2,
      basePrice: { amount: 250_000, currency: 'KZT' },
      unitPrice: { amount: 300_000, currency: 'KZT' },
      lineTotal: { amount: 600_000, currency: 'KZT' },
      modifiers: [
        {
          groupId: 'g1',
          groupName: { ru: 'Порция' },
          optionId: 'big',
          optionName: { ru: 'Большая' },
          price: { amount: 50_000, currency: 'KZT' },
        },
      ],
    },
  ],
  comment: 'Без лука',
  deliveryAddress: null,
  contactless: false,
  allowedTransitions: ['accepted'],
  isLate: true,
  canCancel: false,
  canReject: true,
  courier: null,
  amountDue: { amount: 1_250_000, currency: 'KZT' },
};

const noop = () => undefined;
const now = Date.parse('2026-09-25T10:12:00.000Z');

describe('карточка очереди', { timeout: 30_000 }, () => {
  it('показывает состав, время, оплату, опоздание и кнопки из allowedTransitions', () => {
    wrap(<QueueCard order={order} now={now} highlighted showBranch={false} onOpen={noop} onReject={noop} onCancel={noop} />);
    expect(screen.getByText('GL-2026-000123')).toBeTruthy();
    expect(screen.getByText('Новый')).toBeTruthy();
    expect(screen.getAllByText(/12 мин/).length).toBeGreaterThan(0);
    expect(screen.getByText('Оплачен онлайн')).toBeTruthy();
    expect(screen.getByText('Самовывоз')).toBeTruthy();
    expect(screen.getByText('По телефону')).toBeTruthy();
    expect(screen.getByText('Опаздывает')).toBeTruthy();
    expect(screen.getByText(/Ко времени/)).toBeTruthy();
    expect(screen.getByText(/Плов/)).toBeTruthy();
    expect(screen.getByText(/Большая/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Принять/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Отказать/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Готовить/ })).toBeNull();
  });

  it('без разрешённых переходов (нет права orders.manage) кнопок действий нет', () => {
    wrap(<QueueCard order={{ ...order, allowedTransitions: [], canReject: false, canCancel: false }} now={now} highlighted={false} showBranch onOpen={noop} onReject={noop} onCancel={noop} />);
    expect(screen.queryByRole('button', { name: /Принять/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Отказать/ })).toBeNull();
    expect(screen.getByText('Филиал b1')).toBeTruthy();
  });

  it('отказ — только по флагу сервера canReject', () => {
    wrap(<QueueCard order={{ ...order, canReject: false }} now={now} highlighted={false} showBranch={false} onOpen={noop} onReject={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: /Принять/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Отказать/ })).toBeNull();
  });

  it('курьер службы доставки — из ответа очереди, без запроса карточки заказа', () => {
    wrap(
      <QueueCard
        order={{
          ...order,
          type: 'delivery',
          status: 'delivering',
          allowedTransitions: ['completed'],
          canReject: false,
          courier: { status: 'picked_up', trackingUrl: 'https://track/1', courierName: 'Ерлан' },
        }}
        now={now}
        highlighted={false}
        showBranch={false}
        onOpen={noop}
        onReject={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText('Курьер забрал заказ')).toBeTruthy();
    expect(screen.getByText(/Ерлан/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Отследить курьера' }).getAttribute('href')).toBe('https://track/1');
    expect(getOrder).not.toHaveBeenCalled();
  });

  it('оплата при получении: подтверждение выдачи показывает сумму к получению', async () => {
    wrap(
      <QueueCard
        order={{
          ...order,
          status: 'ready',
          paymentMethod: 'on_receipt',
          allowedTransitions: ['completed'],
          canReject: false,
          amountDue: { amount: 1_000_000, currency: 'KZT' },
        }}
        now={now}
        highlighted={false}
        showBranch={false}
        onOpen={noop}
        onReject={noop}
        onCancel={noop}
      />,
    );
    expect(screen.getByText(/к получению: 10\s000/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Выдан/ }));
    await waitFor(() => expect(screen.getByText(/Получите с гостя 10\s000/)).toBeTruthy());
    expect(transition).not.toHaveBeenCalled();
  });

  it('«Принять» отправляет переход accepted; «Отказать» открывает диалог причины', async () => {
    const onReject = vi.fn();
    transition.mockResolvedValue({ ...order, status: 'accepted' });
    wrap(<QueueCard order={order} now={now} highlighted={false} showBranch={false} onOpen={noop} onReject={onReject} onCancel={noop} />);
    fireEvent.click(screen.getByRole('button', { name: /Принять/ }));
    await waitFor(() => expect(transition).toHaveBeenCalledWith('o1', 'accepted'));
    fireEvent.click(screen.getByRole('button', { name: /Отказать/ }));
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
