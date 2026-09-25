import { describe, expect, it } from 'vitest';
import { dayjs } from '@/shared/lib/dates';
import {
  bpToPercentText,
  emptyPromoForm,
  formValuesToPromoInput,
  normalizePromoCode,
  percentTextToBp,
  promoToFormValues,
  promoToInput,
  validatePromoForm,
  type PromoCode,
  type PromoFormValues,
} from './promo-form';

const promo: PromoCode = {
  id: 'p1',
  code: 'WELCOME10',
  description: 'Первый заказ',
  kind: 'percent',
  percentBp: 1250,
  fixedAmount: null,
  minSubtotal: { amount: 500_000, currency: 'KZT' },
  validFrom: '2026-09-30T19:00:00.000Z',
  validTo: '2026-10-31T19:00:00.000Z',
  totalLimit: 100,
  perPhoneLimit: 1,
  branchId: null,
  isActive: true,
  usage: { reserved: 1, used: 5, released: 2 },
  editable: true,
};

describe('процент ⇄ базисные пункты (без плавающей точки)', () => {
  it('ввод процента → б.п.', () => {
    expect(percentTextToBp('10')).toEqual({ ok: true, value: 1000 });
    expect(percentTextToBp('12,5')).toEqual({ ok: true, value: 1250 });
    expect(percentTextToBp('12.55 %')).toEqual({ ok: true, value: 1255 });
    expect(percentTextToBp('0,01')).toEqual({ ok: true, value: 1 });
    expect(percentTextToBp('100')).toEqual({ ok: true, value: 10_000 });
  });

  it('вне диапазона и неверный ввод', () => {
    expect(percentTextToBp('0')).toEqual({ ok: false, error: 'out_of_range' });
    expect(percentTextToBp('100,01')).toEqual({ ok: false, error: 'out_of_range' });
    expect(percentTextToBp('1,234')).toEqual({ ok: false, error: 'too_many_decimals' });
    expect(percentTextToBp('abc')).toEqual({ ok: false, error: 'invalid' });
  });

  it('б.п. → текст поля', () => {
    expect(bpToPercentText(1000)).toBe('10');
    expect(bpToPercentText(1250)).toBe('12,50');
    expect(bpToPercentText(null)).toBe('');
  });
});

describe('форма промокода ⇄ API', () => {
  it('промокод → форма: процент строкой, суммы в тиынах, даты — стенные часы Алматы', () => {
    const values = promoToFormValues(promo);
    expect(values.percent).toBe('12,50');
    expect(values.minSubtotal).toBe(500_000);
    expect(values.validFrom?.format('YYYY-MM-DD HH:mm')).toBe('2026-10-01 00:00');
    expect(values.validTo?.format('YYYY-MM-DD HH:mm')).toBe('2026-11-01 00:00');
    expect(values.branchId).toBeNull();
  });

  it('форма → тело запроса: код нормализуется, процент в б.п., даты в ISO UTC', () => {
    const input = formValuesToPromoInput(promoToFormValues(promo));
    expect(input).toEqual({
      code: 'WELCOME10',
      description: 'Первый заказ',
      kind: 'percent',
      percentBp: 1250,
      fixedAmount: null,
      minSubtotal: { amount: 500_000, currency: 'KZT' },
      validFrom: '2026-09-30T19:00:00.000Z',
      validTo: '2026-10-31T19:00:00.000Z',
      totalLimit: 100,
      perPhoneLimit: 1,
      branchId: null,
      isActive: true,
    });
  });

  it('фиксированная скидка — Money в тиынах, процент не отправляется', () => {
    const values: PromoFormValues = { ...emptyPromoForm('b1'), code: ' minus 500 ', kind: 'fixed', percent: '10', fixedAmount: 50_000 };
    expect(normalizePromoCode(values.code)).toBe('MINUS500');
    const input = formValuesToPromoInput(values);
    expect(input).toMatchObject({ code: 'MINUS500', kind: 'fixed', percentBp: null, fixedAmount: { amount: 50_000, currency: 'KZT' }, branchId: 'b1' });
    expect(input.validFrom).toBeNull();
    expect(input.minSubtotal).toBeNull();
  });

  it('бесплатная доставка — без суммы и процента; нулевой минимум не отправляется', () => {
    const values: PromoFormValues = { ...emptyPromoForm(null), code: 'FREE', kind: 'free_delivery', percent: '5', fixedAmount: 100, minSubtotal: 0 };
    expect(formValuesToPromoInput(values)).toMatchObject({ kind: 'free_delivery', percentBp: null, fixedAmount: null, minSubtotal: null });
  });

  it('деактивация: промокод без изменений, кроме isActive', () => {
    expect(promoToInput(promo, { isActive: false })).toEqual({ ...formValuesToPromoInput(promoToFormValues(promo)), isActive: false });
  });

  it('проверки формы', () => {
    const base: PromoFormValues = { ...emptyPromoForm('b1'), code: 'OK10', percent: '10' };
    expect(validatePromoForm(base, { canNetwork: false })).toEqual({});
    expect(validatePromoForm({ ...base, code: 'ab' }, { canNetwork: false })).toEqual({ code: 'code_format' });
    expect(validatePromoForm({ ...base, code: 'СКИДКА' }, { canNetwork: false })).toEqual({ code: 'code_format' });
    expect(validatePromoForm({ ...base, percent: '' }, { canNetwork: false })).toEqual({ percent: 'percent_required' });
    expect(validatePromoForm({ ...base, percent: '150' }, { canNetwork: false })).toEqual({ percent: 'percent_range' });
    expect(validatePromoForm({ ...base, percent: 'десять' }, { canNetwork: false })).toEqual({ percent: 'percent_invalid' });
    expect(validatePromoForm({ ...base, kind: 'fixed' }, { canNetwork: false })).toEqual({ fixedAmount: 'fixed_required' });
    expect(validatePromoForm({ ...base, kind: 'fixed', fixedAmount: 0 }, { canNetwork: false })).toEqual({ fixedAmount: 'fixed_positive' });
    expect(validatePromoForm({ ...base, totalLimit: 0, perPhoneLimit: 1.5 }, { canNetwork: false })).toEqual({
      totalLimit: 'limit_invalid',
      perPhoneLimit: 'limit_invalid',
    });
    const day = dayjs('2026-10-01T10:00:00');
    expect(validatePromoForm({ ...base, validFrom: day, validTo: day }, { canNetwork: false })).toEqual({ validTo: 'period_invalid' });
    expect(validatePromoForm({ ...base, validFrom: day, validTo: day.add(1, 'hour') }, { canNetwork: false })).toEqual({});
  });

  it('промокод на всю сеть — только с глобальным правом', () => {
    const network: PromoFormValues = { ...emptyPromoForm(null), code: 'ALL', kind: 'free_delivery' };
    expect(validatePromoForm(network, { canNetwork: false })).toEqual({ branchId: 'network_forbidden' });
    expect(validatePromoForm(network, { canNetwork: true })).toEqual({});
  });
});
