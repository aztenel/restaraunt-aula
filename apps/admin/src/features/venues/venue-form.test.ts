import { describe, expect, it } from 'vitest';
import { moneyToDisplayText, parseMoneyInput } from '@/shared/ui/money-input';
import type { Venue, VenueRules } from './types';
import {
  DEFAULT_RULES,
  capacityIssue,
  depositIssue,
  depositToForm,
  effectiveRuleValue,
  formToDeposit,
  formToOverrides,
  formToRules,
  formToSettings,
  formToVenueInput,
  formToVenueTypeInput,
  overridesToForm,
  ruleInRange,
  venueToForm,
  venueTypeToForm,
} from './venue-form';

const typeRules: VenueRules = {
  durationMinutes: 180,
  holdMinutes: 60,
  cancellationDeadlineHours: 24,
  requiresManualConfirmation: true,
  cleanupMinutes: 30,
  slotStepMinutes: 30,
  bookableOnline: false,
};

describe('правила брони типа места ⇄ API', () => {
  it('полный набор правил: из формы — целые числа и булевы, недостающие — по умолчанию', () => {
    expect(formToRules({ durationMinutes: 90.4, bookableOnline: false })).toEqual({ ...DEFAULT_RULES, durationMinutes: 90, bookableOnline: false });
  });

  it('тип места: код в нижнем регистре, правила целиком', () => {
    const form = venueTypeToForm(null);
    expect(form.rules).toEqual(DEFAULT_RULES);
    const input = formToVenueTypeInput({ ...form, code: ' VIP_Hall ', name: { ru: 'VIP-зал', kk: 'VIP-зал' }, rules: typeRules });
    expect(input).toMatchObject({ code: 'vip_hall', rules: typeRules, isActive: true, sortOrder: 0 });
  });

  it('границы правил — как на сервере', () => {
    expect(ruleInRange('durationMinutes', 15)).toBe(true);
    expect(ruleInRange('durationMinutes', 10)).toBe(false);
    expect(ruleInRange('cancellationDeadlineHours', 0)).toBe(true);
    expect(ruleInRange('slotStepMinutes', 2.5)).toBe(false);
  });
});

describe('переопределения правил у места ⇄ API', () => {
  it('нет своих правил — всё «как у типа», в форме видны значения типа', () => {
    const form = overridesToForm({}, typeRules);
    expect(form.durationMinutes).toEqual({ custom: false, value: 180 });
    expect(form.bookableOnline).toEqual({ custom: false, value: false });
    expect(formToOverrides(form)).toBeNull();
  });

  it('свои значения — числом/булевым, остальные ключи — null (полная замена на сервере)', () => {
    const form = overridesToForm({ cancellationDeadlineHours: 48, bookableOnline: true, holdMinutes: null }, typeRules);
    expect(form.cancellationDeadlineHours).toEqual({ custom: true, value: 48 });
    expect(form.holdMinutes).toEqual({ custom: false, value: 60 });
    expect(formToOverrides(form)).toEqual({
      durationMinutes: null,
      holdMinutes: null,
      cancellationDeadlineHours: 48,
      requiresManualConfirmation: null,
      cleanupMinutes: null,
      slotStepMinutes: null,
      bookableOnline: true,
    });
  });

  it('выключенное «своё значение» не отправляется, даже если число осталось в форме', () => {
    const form = overridesToForm({ durationMinutes: 90 }, typeRules);
    const next = { ...form, durationMinutes: { custom: false, value: 90 } };
    expect(formToOverrides(next)).toBeNull();
    expect(effectiveRuleValue(next.durationMinutes, typeRules, 'durationMinutes')).toBe(180);
    expect(effectiveRuleValue(form.durationMinutes, typeRules, 'durationMinutes')).toBe(90);
  });

  it('булево «нет» — тоже своё значение (не путать с «как у типа»)', () => {
    const form = overridesToForm({ requiresManualConfirmation: false }, typeRules);
    expect(form.requiresManualConfirmation).toEqual({ custom: true, value: false });
    expect(formToOverrides(form)).toMatchObject({ requiresManualConfirmation: false, durationMinutes: null });
  });
});

describe('депозит места: тиыны ⇄ Money', () => {
  it('Money с сервера → форма (тиыны целиком) → Money без потерь', () => {
    const form = depositToForm({ amount: 2_500_050, currency: 'KZT' });
    expect(form).toEqual({ depositEnabled: true, depositAmount: 2_500_050 });
    expect(formToDeposit(form)).toEqual({ amount: 2_500_050, currency: 'KZT' });
    expect(moneyToDisplayText(form.depositAmount, 'ru')).toBe('25 000,50');
  });

  it('ввод «15 000» ₸ → 1 500 000 тиынов без плавающей точки', () => {
    const parsed = parseMoneyInput('15 000');
    expect(parsed).toEqual({ value: 1_500_000, error: null });
    expect(formToDeposit({ depositEnabled: true, depositAmount: parsed.value })).toEqual({ amount: 1_500_000, currency: 'KZT' });
    expect(parseMoneyInput('0,1').value).toBe(10);
  });

  it('без депозита — null (убрать депозит); включён без суммы или ноль — ошибка', () => {
    expect(depositToForm(null)).toEqual({ depositEnabled: false, depositAmount: null });
    expect(formToDeposit({ depositEnabled: false, depositAmount: 100_000 })).toBeNull();
    expect(depositIssue({ depositEnabled: true, depositAmount: null })).toBe('deposit_required');
    expect(depositIssue({ depositEnabled: true, depositAmount: 0 })).toBe('deposit_positive');
    expect(formToDeposit({ depositEnabled: true, depositAmount: 0 })).toBeNull();
    expect(depositIssue({ depositEnabled: false, depositAmount: null })).toBeNull();
  });
});

describe('место: форма ⇄ API', () => {
  const venue: Venue = {
    id: 'v1',
    branchId: 'b1',
    hallId: 'h1',
    hallName: { ru: 'Основной' },
    typeId: 't1',
    typeCode: 'vip_hall',
    typeName: { ru: 'VIP-зал' },
    code: 'VIP1',
    name: { ru: 'Юрта' },
    description: {},
    capacityMin: 6,
    capacityMax: 20,
    deposit: { amount: 5_000_000, currency: 'KZT' },
    ruleOverrides: { cancellationDeadlineHours: 48 },
    rules: { ...typeRules, cancellationDeadlineHours: 48 },
    position: { x: 100, y: 40, w: 200, h: 120, shape: 'rect', rotation: 90 },
    photos: [],
    sortOrder: 1,
    isActive: true,
    isBookable: true,
    createdAt: '',
    updatedAt: '',
  };

  it('туда и обратно без потерь', () => {
    const form = venueToForm(venue, { hallId: 'h1', typeId: 't1', typeRules });
    const input = formToVenueInput(form);
    expect(input).toEqual({
      hallId: 'h1',
      typeId: 't1',
      code: 'VIP1',
      name: { ru: 'Юрта' },
      description: {},
      capacityMin: 6,
      capacityMax: 20,
      deposit: { amount: 5_000_000, currency: 'KZT' },
      rules: {
        durationMinutes: null,
        holdMinutes: null,
        cancellationDeadlineHours: 48,
        requiresManualConfirmation: null,
        cleanupMinutes: null,
        slotStepMinutes: null,
        bookableOnline: null,
      },
      position: { x: 100, y: 40, w: 200, h: 120, shape: 'rect', rotation: 90 },
      sortOrder: 1,
      isActive: true,
    });
  });

  it('новое место — зал и тип по умолчанию, без депозита и своих правил', () => {
    const input = formToVenueInput({ ...venueToForm(null, { hallId: 'h2', typeId: 't2', typeRules }), code: ' T4 ', name: { ru: 'Стол 4' } });
    expect(input).toMatchObject({ hallId: 'h2', typeId: 't2', code: 'T4', deposit: null, rules: null });
  });

  it('вместимость', () => {
    expect(capacityIssue(2, 6)).toBeNull();
    expect(capacityIssue(6, 2)).toBe('capacity_order');
    expect(capacityIssue(0, 2)).toBe('capacity_range');
    expect(capacityIssue(1, 1001)).toBe('capacity_range');
  });

  it('настройки филиала — целые числа', () => {
    expect(formToSettings({ reminderHoursBefore: 3, minLeadMinutes: 60.2, maxDaysAhead: 60, policyText: { ru: 'Правила' } })).toEqual({
      reminderHoursBefore: 3,
      minLeadMinutes: 60,
      maxDaysAhead: 60,
      policyText: { ru: 'Правила' },
    });
  });
});
