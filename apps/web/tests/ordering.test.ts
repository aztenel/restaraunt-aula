import { describe, expect, it, vi } from 'vitest';
import { canProceedToCheckout, quoteBody, requestQuote, type Quote } from '@/lib/ordering';
import { fail, ok } from './support/api';

const kzt = (amount: number) => ({ amount, currency: 'KZT' as const });

const rawQuote: Quote = {
  branchId: 'b1',
  type: 'pickup' as const,
  lines: [
    { index: 0, dishId: 'd1', name: 'Бешбармак', photoUrl: null, quantity: 2, unitPrice: kzt(450000), lineTotal: kzt(900000), modifiers: [], available: true, problem: null },
    { index: 1, dishId: 'd2', name: null, photoUrl: null, quantity: 1, unitPrice: null, lineTotal: null, modifiers: [], available: false, problem: 'catalog.dish_not_in_branch_menu' },
  ],
  subtotal: kzt(900000),
  discount: kzt(0),
  deliveryFee: kzt(0),
  total: kzt(900000),
  amountDue: kzt(900000),
  delivery: null,
  promo: null,
  certificate: null,
  problems: ['catalog.dish_not_in_branch_menu'],
  canCheckout: false,
};

describe('расчёт корзины (POST /public/orders/quote)', () => {
  it('тело запроса: только заполненные поля (API отклоняет лишние)', () => {
    expect(quoteBody({ branchId: 'b1', type: 'pickup', items: [{ dishId: 'd1', quantity: 1, modifierOptionIds: [] }], promoCode: '  ', deliveryPoint: { lat: 1, lng: 2 } })).toEqual({
      branchId: 'b1',
      type: 'pickup',
      items: [{ dishId: 'd1', quantity: 1, modifierOptionIds: [] }],
    });
    expect(
      quoteBody({ branchId: 'b1', type: 'delivery', items: [], promoCode: 'AULA10', deliveryPoint: { lat: 51.1, lng: 71.4 } }),
    ).toMatchObject({ promoCode: 'AULA10', point: { lat: 51.1, lng: 71.4 } });
  });

  it('недоступная позиция мешает оформлению', () => {
    expect(canProceedToCheckout(rawQuote)).toBe(false);
  });

  it('адрес доставки и неприменённый промокод не мешают перейти к оформлению', () => {
    const quote: Quote = { ...rawQuote, lines: [rawQuote.lines[0]!], problems: ['order.address_required', 'promo.expired'], canCheckout: false };
    expect(canProceedToCheckout(quote)).toBe(true);
    expect(canProceedToCheckout({ ...quote, problems: ['order.min_order_not_reached'] })).toBe(false);
    // Проблема позиции может прийти без поля problem (необязательное поле схемы) — важно available.
    expect(canProceedToCheckout({ ...quote, problems: [], lines: [{ ...rawQuote.lines[0]!, problem: undefined, available: false }] })).toBe(false);
  });

  it('типизированный вызов API с языком; 404 маршрута — «расчёт недоступен», доменная 404 — ошибка', async () => {
    const POST = vi.fn().mockResolvedValue(ok(rawQuote));
    const request = { branchId: 'b1', type: 'pickup' as const, items: [{ dishId: 'd1', quantity: 2, modifierOptionIds: [] }] };
    const result = await requestQuote({ POST } as never, request, { locale: 'kk' });
    expect(result).toEqual({ kind: 'ok', quote: rawQuote });
    expect(POST).toHaveBeenCalledWith(
      '/api/v1/public/orders/quote',
      expect.objectContaining({ params: { query: { locale: 'kk' } }, body: expect.objectContaining({ branchId: 'b1' }) }),
    );

    POST.mockResolvedValueOnce(fail(404, 'http.404'));
    expect((await requestQuote({ POST } as never, request, { locale: 'ru' })).kind).toBe('unavailable');

    POST.mockResolvedValueOnce(fail(404, 'branch.not_found'));
    const missingBranch = await requestQuote({ POST } as never, request, { locale: 'ru' });
    expect(missingBranch.kind === 'error' && missingBranch.error.code).toBe('branch.not_found');

    POST.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const offline = await requestQuote({ POST } as never, request, { locale: 'ru' });
    expect(offline.kind === 'error' && offline.error.isNetworkError).toBe(true);
  });
});
