import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@aula/api-client';
import { canProceedToCheckout, normalizeQuote, quoteBody, QUOTE_PATH, requestQuote } from '@/lib/ordering';

const kzt = (amount: number) => ({ amount, currency: 'KZT' });

const rawQuote = {
  branchId: 'b1',
  type: 'pickup',
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
    expect(quoteBody({ branchId: 'b1', type: 'pickup', items: [{ dishId: 'd1', quantity: 1, modifierOptionIds: [] }], promoCode: '  ', scheduledFor: '2026-09-25T10:00:00Z' })).toEqual({
      branchId: 'b1',
      type: 'pickup',
      items: [{ dishId: 'd1', quantity: 1, modifierOptionIds: [] }],
    });
    expect(
      quoteBody({ branchId: 'b1', type: 'delivery', items: [], promoCode: 'AULA10', deliveryPoint: { lat: 51.1, lng: 71.4 } }),
    ).toMatchObject({ promoCode: 'AULA10', point: { lat: 51.1, lng: 71.4 } });
  });

  it('разбирает ответ, не пересчитывая суммы', () => {
    const quote = normalizeQuote(rawQuote)!;
    expect(quote.total).toEqual({ amount: 900000, currency: 'KZT' });
    expect(quote.lines[1]).toMatchObject({ available: false, problem: 'catalog.dish_not_in_branch_menu', lineTotal: null });
    expect(canProceedToCheckout(quote)).toBe(false);
    expect(normalizeQuote({ nope: true })).toBeNull();
  });

  it('адрес доставки и неприменённый промокод не мешают перейти к оформлению', () => {
    const quote = normalizeQuote({ ...rawQuote, lines: [rawQuote.lines[0]], problems: ['order.address_required', 'promo.expired'], canCheckout: false })!;
    expect(canProceedToCheckout(quote)).toBe(true);
    const min = normalizeQuote({ ...rawQuote, lines: [rawQuote.lines[0]], problems: ['order.min_order_not_reached'] })!;
    expect(canProceedToCheckout(min)).toBe(false);
  });

  it('вызывает API через raw() с языком; 404 маршрута — «расчёт недоступен», доменная 404 — ошибка', async () => {
    const raw = vi.fn().mockResolvedValue(rawQuote);
    const request = { branchId: 'b1', type: 'pickup' as const, items: [{ dishId: 'd1', quantity: 2, modifierOptionIds: [] }] };
    const ok = await requestQuote({ raw }, request, { locale: 'kk' });
    expect(ok.kind).toBe('ok');
    expect(raw).toHaveBeenCalledWith('POST', QUOTE_PATH, expect.objectContaining({ query: { locale: 'kk' }, body: expect.objectContaining({ branchId: 'b1' }) }));

    raw.mockRejectedValueOnce(new ApiError({ status: 404, code: 'http.404', message: 'Cannot POST' }));
    expect((await requestQuote({ raw }, request, { locale: 'ru' })).kind).toBe('unavailable');

    raw.mockRejectedValueOnce(new ApiError({ status: 404, code: 'branch.not_found' }));
    const missingBranch = await requestQuote({ raw }, request, { locale: 'ru' });
    expect(missingBranch.kind === 'error' && missingBranch.error.code).toBe('branch.not_found');

    raw.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const offline = await requestQuote({ raw }, request, { locale: 'ru' });
    expect(offline.kind === 'error' && offline.error.isNetworkError).toBe(true);
  });
});
