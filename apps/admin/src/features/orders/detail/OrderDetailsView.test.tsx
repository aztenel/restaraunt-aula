// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { i18n } from '@/shared/i18n';
import type { AdminOrderDetails } from '../types';
import { OrderDetailsView } from './OrderDetailsView';

const permissions = new Set<string>(['orders.view', 'orders.manage']);

vi.mock('@/shared/auth/useCan', () => ({
  useCan: () => ({
    can: (permission: string) => permissions.has(permission),
    canSomewhere: (permission: string) => permissions.has(permission),
    canHere: (permission: string) => permissions.has(permission),
    canAny: () => true,
    branchesWith: () => 'all',
  }),
}));

vi.mock('@/shared/branch/BranchProvider', () => ({
  useBranch: () => ({ branchName: () => 'Garden View', getBranch: () => ({ location: { lat: 51.12, lng: 71.43 } }) }),
}));

vi.mock('./PointMap', () => ({ default: () => <div>карта</div> }));

beforeAll(async () => {
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
  // jsdom не поддерживает getComputedStyle(elt, pseudoElt) — rc-table меряет полосу прокрутки так.
  const getComputedStyle = window.getComputedStyle.bind(window);
  window.getComputedStyle = ((elt: Element) => getComputedStyle(elt)) as typeof window.getComputedStyle;
  await i18n.changeLanguage('ru');
});

afterEach(() => {
  cleanup();
  permissions.clear();
  permissions.add('orders.view');
  permissions.add('orders.manage');
});

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <App>{children}</App>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

const money = (amount: number) => ({ amount, currency: 'KZT' as const });

const order: AdminOrderDetails = {
  id: 'o1',
  number: 'GV-2026-000045',
  branchId: 'b1',
  type: 'delivery',
  channel: 'web',
  status: 'ready',
  customer: { customerId: 'c1', name: 'Данияр', phone: '+77011234567', email: null },
  total: money(1_080_000),
  paymentMethod: 'on_receipt',
  promoCode: 'WELCOME10',
  placedAt: '2026-09-25T09:00:00.000Z',
  scheduledFor: null,
  promisedAt: '2026-09-25T10:00:00.000Z',
  publicToken: 'tok',
  locale: 'ru',
  items: [
    {
      id: 'i1',
      position: 1,
      dishId: 'd1',
      sku: null,
      name: { ru: 'Бешбармак' },
      photoUrl: null,
      weightGrams: null,
      quantity: 1,
      basePrice: money(1_000_000),
      unitPrice: money(1_000_000),
      lineTotal: money(1_000_000),
      modifiers: [],
    },
  ],
  subtotal: money(1_000_000),
  discount: money(100_000),
  deliveryFee: money(180_000),
  promoKind: 'percent',
  certificateMaskedCode: null,
  certificateAmount: money(0),
  amountDue: money(1_080_000),
  delivery: {
    point: { lat: 51.1, lng: 71.4 },
    addressText: 'пр. Туран, 10',
    apartment: '5',
    entrance: null,
    floor: null,
    intercom: null,
    courierComment: null,
    zoneId: 'z1',
    zoneName: { ru: 'Центр' },
    contactless: false,
  },
  comment: null,
  etaMinutes: 60,
  analyticsSessionId: null,
  createdBy: null,
  wasPaid: true,
  cancellation: null,
  timestamps: {
    placedAt: '2026-09-25T09:00:00.000Z',
    paidAt: '2026-09-25T09:00:00.000Z',
    acceptedAt: '2026-09-25T09:01:00.000Z',
    cookingAt: '2026-09-25T09:05:00.000Z',
    readyAt: '2026-09-25T09:40:00.000Z',
    deliveringAt: null,
    completedAt: null,
    cancelledAt: null,
    refundedAt: null,
  },
  payments: [],
  refunds: [],
  courierDispatch: {
    id: 'cd1',
    provider: 'yandex',
    status: 'failed',
    providerStatus: 'failed',
    externalId: null,
    trackingUrl: null,
    courierName: null,
    courierPhone: null,
    price: null,
    attempts: 6,
    lastError: 'timeout',
    requestedAt: '2026-09-25T09:40:00.000Z',
    finishedAt: '2026-09-25T09:50:00.000Z',
  },
  history: [
    { from: null, to: 'paid', at: '2026-09-25T09:00:00.000Z', actorKind: 'guest', actorName: 'Гость', actorUserId: null, reasonCode: null, reason: null },
    { from: 'paid', to: 'accepted', at: '2026-09-25T09:01:00.000Z', actorKind: 'staff', actorName: 'Оператор Асель', actorUserId: 'u1', reasonCode: null, reason: null },
  ],
  allowedTransitions: ['delivering'],
  canCancel: false,
  canReject: false,
  canRefund: false,
  refundable: money(0),
  trackingUrl: 'https://aula.kz/ru/orders/tok',
};

describe('карточка заказа', () => {
  it('состав, суммы с сервера, адрес, курьер и действия из allowedTransitions', () => {
    wrap(<OrderDetailsView order={order} />);
    expect(screen.getByText('Бешбармак')).toBeTruthy();
    expect(screen.getByText(/WELCOME10/)).toBeTruthy();
    expect(screen.getByText('пр. Туран, 10')).toBeTruthy();
    expect(screen.getByText('Центр')).toBeTruthy();
    expect(screen.getByText('Не удалось вызвать')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Вызвать курьера снова/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Передать курьеру/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Отменить/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Отказать/ })).toBeNull();
  });

  it('история статусов и вкладка журнала без права audit.view', async () => {
    wrap(<OrderDetailsView order={order} />);
    fireEvent.click(screen.getByRole('tab', { name: 'История' }));
    await waitFor(() => expect(screen.getByText('Оператор Асель')).toBeTruthy());
    fireEvent.click(screen.getByRole('tab', { name: 'Журнал' }));
    await waitFor(() => expect(screen.getByText(/Журнал действий доступен/)).toBeTruthy());
  });

  it('без права orders.manage — нет кнопок курьера', () => {
    permissions.delete('orders.manage');
    wrap(<OrderDetailsView order={{ ...order, allowedTransitions: [] }} />);
    expect(screen.queryByRole('button', { name: /Вызвать курьера снова/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Передать курьеру/ })).toBeNull();
  });
});
