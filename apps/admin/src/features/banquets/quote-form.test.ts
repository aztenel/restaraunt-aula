import { describe, expect, it } from 'vitest';
import {
  bpToPercentInput,
  discountFromApi,
  discountToApi,
  emptyQuoteForm,
  formToSaveInput,
  lineIssues,
  moveLine,
  newCustomLine,
  newMenuLine,
  percentTextToBp,
  previewLineTotal,
  quoteToForm,
  type QuoteFormValues,
} from './quote-form';
import type { DishOption, Quote } from './types';

const tenge = (amount: number) => ({ amount, currency: 'KZT' as const });

const plov: DishOption = {
  dishId: 'dish-plov',
  name: { ru: 'Плов', kk: 'Палау' },
  price: tenge(250_000),
  availability: 'available',
  photoUrl: null,
  weightGrams: 350,
};

const savedQuote: Quote = {
  id: 'q1',
  requestId: 'r1',
  version: 2,
  branchId: 'b1',
  guests: 80,
  discount: { type: 'amount', bp: null, amount: tenge(1_000_000) },
  serviceChargeBp: 1000,
  vatPayer: true,
  vatRateBp: 1600,
  lines: [
    {
      position: 2,
      kind: 'hall_rent',
      dishId: null,
      title: { ru: 'Аренда зала', kk: 'Зал жалдау' },
      unit: 'час',
      quantity: 6,
      unitPrice: tenge(5_000_050),
      discount: null,
      gross: tenge(30_000_300),
      discountAmount: tenge(0),
      total: tenge(30_000_300),
    },
    {
      position: 1,
      kind: 'menu',
      dishId: 'dish-plov',
      title: { ru: 'Плов', kk: 'Палау' },
      unit: 'порц.',
      quantity: 80,
      unitPrice: tenge(240_000),
      discount: { type: 'percent', bp: 1250, amount: null },
      gross: tenge(19_200_000),
      discountAmount: tenge(2_400_000),
      total: tenge(16_800_000),
    },
  ],
  totals: {
    subtotal: tenge(49_200_300),
    linesDiscount: tenge(2_400_000),
    overallDiscount: tenge(1_000_000),
    discount: tenge(3_400_000),
    service: tenge(4_580_030),
    total: tenge(50_380_330),
    vat: tenge(6_948_321),
    perGuest: tenge(629_754),
  },
  validUntil: '2026-10-15',
  notes: 'Без острого',
  seller: { name: 'ТОО AULA', bin: '123456789012' },
  pdfReady: false,
  createdByName: 'Айгерим',
  createdAt: '2026-10-01T10:00:00.000Z',
  sentAt: null,
  acceptedAt: null,
  isLatest: true,
};

describe('проценты ⇄ базисные пункты (без плавающей точки)', () => {
  it('ввод процентов', () => {
    expect(percentTextToBp('10')).toEqual({ ok: true, value: 1000 });
    expect(percentTextToBp('12,5')).toEqual({ ok: true, value: 1250 });
    expect(percentTextToBp('0.05')).toEqual({ ok: true, value: 5 });
    expect(percentTextToBp('100')).toEqual({ ok: true, value: 10_000 });
    expect(percentTextToBp('100,01')).toEqual({ ok: false });
    expect(percentTextToBp('12,345')).toEqual({ ok: false });
    expect(percentTextToBp('-5')).toEqual({ ok: false });
    expect(percentTextToBp('abc')).toEqual({ ok: false });
  });

  it('показ процентов в поле', () => {
    expect(bpToPercentInput(1250)).toBe('12,5');
    expect(bpToPercentInput(1000)).toBe('10');
    expect(bpToPercentInput(1205)).toBe('12,05');
    expect(bpToPercentInput(5)).toBe('0,05');
    expect(bpToPercentInput(1250, 'en')).toBe('12.5');
    expect(bpToPercentInput(null)).toBe('');
  });
});

describe('скидки', () => {
  it('из API в форму', () => {
    expect(discountFromApi(null)).toEqual({ mode: 'none', percent: '', amount: null });
    expect(discountFromApi({ type: 'percent', bp: 1250, amount: null })).toEqual({ mode: 'percent', percent: '12,5', amount: null });
    expect(discountFromApi({ type: 'amount', bp: null, amount: tenge(150_050) })).toEqual({ mode: 'amount', percent: '', amount: 150_050 });
  });

  it('из формы в API: процент — bp, сумма — тиыны', () => {
    expect(discountToApi({ mode: 'percent', percent: '7,5', amount: null })).toEqual({ ok: true, value: { type: 'percent', bp: 750 } });
    expect(discountToApi({ mode: 'amount', percent: '', amount: 250_050 })).toEqual({
      ok: true,
      value: { type: 'amount', amount: { amount: 250_050, currency: 'KZT' } },
    });
    expect(discountToApi({ mode: 'none', percent: '10', amount: 5 })).toEqual({ ok: true, value: undefined });
    expect(discountToApi({ mode: 'percent', percent: '0', amount: null })).toEqual({ ok: true, value: undefined });
    expect(discountToApi({ mode: 'percent', percent: '', amount: null })).toEqual({ ok: false, code: 'discountPercentInvalid' });
    expect(discountToApi({ mode: 'percent', percent: '120', amount: null })).toEqual({ ok: false, code: 'discountPercentInvalid' });
    expect(discountToApi({ mode: 'amount', percent: '', amount: null })).toEqual({ ok: false, code: 'discountAmountRequired' });
  });
});

describe('версия сметы → форма новой версии', () => {
  it('строки по порядку, снимок цены меню, проценты и суммы', () => {
    const form = quoteToForm(savedQuote);
    expect(form.lines.map((l) => l.kind)).toEqual(['menu', 'hall_rent']);
    expect(form.lines[0]).toMatchObject({
      dishId: 'dish-plov',
      dishName: { ru: 'Плов', kk: 'Палау' },
      shownPrice: tenge(240_000),
      priceSource: 'snapshot',
      quantity: 80,
      unitPrice: null,
      discount: { mode: 'percent', percent: '12,5', amount: null },
    });
    expect(form.lines[1]).toMatchObject({ dishId: null, title: { ru: 'Аренда зала', kk: 'Зал жалдау' }, unit: 'час', unitPrice: 5_000_050 });
    expect(form.discount).toEqual({ mode: 'amount', percent: '', amount: 1_000_000 });
    expect(form.serviceCharge).toBe('10');
    expect(form.guests).toBe(80);
    expect(form.validUntil).toBeNull();
    expect(form.notes).toBe('Без острого');
  });

  it('форма → API: меню — только блюдо и количество, произвольные — название, единица, цена', () => {
    const result = formToSaveInput({ ...quoteToForm(savedQuote), validUntil: '2026-10-20', refreshMenuPrices: true });
    expect(result).toEqual({
      ok: true,
      input: {
        lines: [
          { kind: 'menu', dishId: 'dish-plov', quantity: 80, unit: 'порц.', discount: { type: 'percent', bp: 1250 } },
          {
            kind: 'hall_rent',
            title: { ru: 'Аренда зала', kk: 'Зал жалдау' },
            unit: 'час',
            unitPrice: { amount: 5_000_050, currency: 'KZT' },
            quantity: 6,
          },
        ],
        discount: { type: 'amount', amount: { amount: 1_000_000, currency: 'KZT' } },
        serviceChargeBp: 1000,
        guests: 80,
        validUntil: '2026-10-20',
        notes: 'Без острого',
        refreshMenuPrices: true,
      },
    });
  });

  it('новое блюдо из поиска: цена меню показана справочно, в API не уходит', () => {
    const line = { ...newMenuLine(plov), quantity: 10 };
    expect(line).toMatchObject({ shownPrice: tenge(250_000), priceSource: 'menu', availability: 'available' });
    const result = formToSaveInput({ ...emptyQuoteForm(50), lines: [line] });
    expect(result).toEqual({ ok: true, input: { lines: [{ kind: 'menu', dishId: 'dish-plov', quantity: 10, unit: 'порц.' }], serviceChargeBp: 0, guests: 50 } });
  });
});

describe('проверки формы сметы (подсказки до отправки)', () => {
  it('пустая смета', () => {
    expect(formToSaveInput(emptyQuoteForm(10))).toEqual({ ok: false, issues: [{ code: 'noLines', field: 'lines' }] });
  });

  it('произвольная позиция без названия, единицы и цены; количество вне диапазона', () => {
    const line = { ...newCustomLine('musicians'), quantity: 0 };
    const result = formToSaveInput({ ...emptyQuoteForm(10), lines: [line] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(lineIssues(result.issues, 1).map((i) => i.code)).toEqual(['quantityInvalid', 'titleRequired', 'unitRequired', 'priceRequired']);
  });

  it('скидка строки, обслуживание больше 50% и гости', () => {
    const line = { ...newCustomLine('decoration', 'усл.'), title: { ru: 'Цветы' }, unitPrice: 100_000, discount: { mode: 'percent' as const, percent: '150', amount: null } };
    const values: QuoteFormValues = { ...emptyQuoteForm(0), lines: [line], serviceCharge: '55' };
    const result = formToSaveInput(values);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => [i.code, i.line ?? null])).toEqual([
      ['discountPercentInvalid', 1],
      ['serviceChargeInvalid', null],
      ['guestsInvalid', null],
    ]);
  });

  it('пустой процент обслуживания — 0; казахское название без русского допустимо', () => {
    const line = { ...newCustomLine('service', 'чел.'), title: { kk: '  Даяшылар  ', ru: '  ' }, unitPrice: 0 };
    const result = formToSaveInput({ ...emptyQuoteForm(null), lines: [line] });
    expect(result).toEqual({
      ok: true,
      input: { lines: [{ kind: 'service', title: { kk: 'Даяшылар' }, unit: 'чел.', unitPrice: { amount: 0, currency: 'KZT' }, quantity: 1 }], serviceChargeBp: 0 },
    });
  });

  it('перестановка строк', () => {
    const a = newCustomLine('other');
    const b = newCustomLine('service');
    expect(moveLine([a, b], 1, -1).map((l) => l.key)).toEqual([b.key, a.key]);
    expect(moveLine([a, b], 0, -1).map((l) => l.key)).toEqual([a.key, b.key]);
  });
});

describe('предпросмотр сметы (итоги — только от сервера)', () => {
  it('итог строки из ответа сервера по позиции; устаревший предпросмотр не показывается', () => {
    const preview = { lines: savedQuote.lines };
    expect(previewLineTotal(preview, 0, 2)).toEqual(tenge(16_800_000));
    expect(previewLineTotal(preview, 1, 2)).toEqual(tenge(30_000_300));
    // Строку добавили, а предпросмотр ещё считается для старого набора.
    expect(previewLineTotal(preview, 0, 3)).toBeNull();
    expect(previewLineTotal(null, 0, 2)).toBeNull();
  });

  it('тело предпросмотра — то же, что при сохранении версии', () => {
    const values = { ...emptyQuoteForm(40), lines: [{ ...newMenuLine(plov), quantity: 40 }], serviceCharge: '10' };
    const result = formToSaveInput(values);
    expect(result).toEqual({ ok: true, input: { lines: [{ kind: 'menu', dishId: 'dish-plov', quantity: 40, unit: 'порц.' }], serviceChargeBp: 1000, guests: 40 } });
  });
});
