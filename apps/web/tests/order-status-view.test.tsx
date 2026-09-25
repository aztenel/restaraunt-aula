import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ru from '@/messages/ru.json';
import { OrderStatusView } from '@/components/orders/OrderStatusView';
import type { OrderTracking } from '@/lib/api-types';
import { ok } from './support/api';

const api = vi.hoisted(() => ({ POST: vi.fn(), GET: vi.fn() }));
const goToPayment = vi.hoisted(() => vi.fn());
const reachGoal = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({ getBrowserApi: () => api }));
vi.mock('@/lib/payment-flow', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/payment-flow')>()), goToPayment }));
vi.mock('@/lib/goals', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/goals')>()), reachGoal }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });

function tracking(patch: Partial<OrderTracking> = {}, payment: Partial<OrderTracking['payment']> = {}): OrderTracking {
  return {
    orderId: 'o1',
    number: 'A-1001',
    status: 'awaiting_payment',
    type: 'pickup',
    placedAt: '2026-09-25T10:00:00Z',
    scheduledFor: null,
    promisedAt: '2026-09-25T10:40:00Z',
    items: [{ dishId: 'd1', name: 'Бешбармак', photoUrl: null, quantity: 2, unitPrice: kzt(520000), lineTotal: kzt(1040000), modifiers: [] }],
    subtotal: kzt(1040000),
    discount: kzt(0),
    deliveryFee: kzt(0),
    total: kzt(1040000),
    promoCode: null,
    comment: null,
    branch: { id: 'b1', slug: 'greenline', name: 'AULA GreenLine', address: 'Кенесары, 40', phone: '+77172000000', location: { lat: 51.1, lng: 71.4 } },
    delivery: null,
    payment: {
      method: 'online',
      isPaid: false,
      certificateAmount: kzt(0),
      amountDue: kzt(1040000),
      current: null,
      canRetry: false,
      payUntil: null,
      ...payment,
    },
    courier: null,
    cancellation: null,
    timeline: [{ status: 'awaiting_payment', at: '2026-09-25T10:00:00Z' }],
    ...patch,
  };
}

const pending = (id: string, paymentUrl: string | null, status: 'pending' | 'failed' = 'pending') => ({ id, method: 'online' as const, status, amount: kzt(1040000), paymentUrl });

function renderView(initial: OrderTracking, autoPay: boolean) {
  return render(
    <NextIntlClientProvider locale="ru" messages={ru} timeZone="Asia/Almaty">
      <OrderStatusView token="tok_ABCDEFGHIJKLMNOP" initial={initial} autoPay={autoPay} />
    </NextIntlClientProvider>,
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('статус заказа: опрос и переход на оплату', () => {
  it('сразу после оформления: ждёт ссылку, переходит на оплату один раз', async () => {
    api.GET.mockResolvedValueOnce(ok(tracking({}, { current: pending('p1', null) }))).mockResolvedValue(ok(tracking({}, { current: pending('p1', 'https://pay.example/p1') })));
    renderView(tracking(), true);
    expect(screen.getByText(/Готовим страницу оплаты/)).toBeTruthy();

    await advance(1600);
    expect(goToPayment).not.toHaveBeenCalled();
    await advance(1600);
    expect(goToPayment).toHaveBeenCalledTimes(1);
    expect(goToPayment).toHaveBeenCalledWith('https://pay.example/p1');

    // Дальнейшие опросы той же попытки больше не переводят.
    await advance(9000);
    expect(api.GET.mock.calls.length).toBeGreaterThan(2);
    expect(goToPayment).toHaveBeenCalledTimes(1);
  });

  it('открыт по ссылке (без ?pay=1): показывает кнопку оплаты, сам не переводит', async () => {
    api.GET.mockResolvedValue(ok(tracking({}, { current: pending('p1', 'https://pay.example/p1') })));
    renderView(tracking({}, { current: pending('p1', 'https://pay.example/p1') }), false);
    const link = screen.getByRole('link', { name: /Оплатить/ });
    expect(link.getAttribute('href')).toBe('https://pay.example/p1');
    await advance(5000);
    expect(goToPayment).not.toHaveBeenCalled();
  });

  it('оплата не прошла: «Оплатить снова» создаёт новую попытку и переводит на неё', async () => {
    api.POST.mockResolvedValue(ok(pending('p2', 'https://pay.example/p2')));
    api.GET.mockResolvedValue(ok(tracking({}, { current: pending('p2', 'https://pay.example/p2'), canRetry: true })));
    renderView(tracking({}, { current: pending('p1', 'https://pay.example/p1', 'failed'), canRetry: true }), false);
    expect(screen.getByText(/Оплата не прошла/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Оплатить снова/ }));
    });
    expect(api.POST).toHaveBeenCalledWith('/api/v1/public/orders/{publicToken}/pay', { params: { path: { publicToken: 'tok_ABCDEFGHIJKLMNOP' } } });
    expect(goToPayment).toHaveBeenCalledWith('https://pay.example/p2');
  });

  it('оплата при получении: «Заказ оформлен», без перехода на оплату', async () => {
    api.GET.mockResolvedValue(ok(tracking({ status: 'paid' }, { method: 'on_receipt', isPaid: true })));
    renderView(tracking({ status: 'paid' }, { method: 'on_receipt', isPaid: true }), true);
    expect(screen.getByRole('heading', { level: 2, name: 'Заказ оформлен' })).toBeTruthy();
    expect(screen.getByText('К оплате при получении')).toBeTruthy();
    await advance(20_000);
    expect(goToPayment).not.toHaveBeenCalled();
  });

  it('оплаченный заказ: цель «покупка» один раз, опрос продолжается до выполнения', async () => {
    const paid = tracking({ status: 'cooking', timeline: [] }, { isPaid: true, current: { ...pending('p1', null), status: 'succeeded' as never } });
    api.GET.mockResolvedValueOnce(ok({ ...paid })).mockResolvedValue(ok({ ...paid, status: 'completed' }));
    renderView(paid, false);
    expect(reachGoal).toHaveBeenCalledTimes(1);
    expect(reachGoal).toHaveBeenCalledWith('purchase', expect.objectContaining({ value: 10400, currency: 'KZT', transaction_id: 'A-1001' }));
    expect(screen.getByText(/Будет готов примерно к/)).toBeTruthy();

    await advance(15_100);
    await advance(15_100);
    expect(screen.getByText(/Спасибо, что выбрали AULA/)).toBeTruthy();
    const calls = api.GET.mock.calls.length;
    await advance(60_000);
    expect(api.GET.mock.calls.length).toBe(calls);
    expect(reachGoal).toHaveBeenCalledTimes(1);
  });
});
