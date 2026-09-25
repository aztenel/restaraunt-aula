import { describe, expect, it } from 'vitest';
import type { PublicModifierGroup } from '../types';
import {
  addLine,
  buildCreateInput,
  buildQuoteInput,
  checkoutChecks,
  defaultModifierSelection,
  isPhoneComplete,
  modifierIssues,
  newIdempotencyKey,
  normalizePhoneInput,
  selectedOptions,
  setLineQuantity,
  type PhoneOrderDetails,
  type PhoneOrderDraft,
} from './phone-order';

const plov = { dishId: 'd1', dishSlug: 'plov', name: 'Плов', quantity: 1, modifierOptionIds: ['o2', 'o1'], modifierLabels: ['Большой'] };

describe('корзина телефонного заказа', () => {
  it('одинаковые позиции (блюдо + опции в любом порядке) объединяются', () => {
    let cart = addLine([], plov);
    cart = addLine(cart, { ...plov, modifierOptionIds: ['o1', 'o2'], quantity: 2 });
    expect(cart).toHaveLength(1);
    expect(cart[0]!.quantity).toBe(3);
    cart = addLine(cart, { ...plov, modifierOptionIds: [] });
    expect(cart).toHaveLength(2);
  });

  it('количество от 1 до 99; ноль убирает позицию', () => {
    const cart = addLine([], plov);
    const key = cart[0]!.key;
    expect(setLineQuantity(cart, key, 150)[0]!.quantity).toBe(99);
    expect(setLineQuantity(cart, key, 0)).toEqual([]);
  });
});

describe('телефон гостя', () => {
  it('нормализация к +7XXXXXXXXXX', () => {
    expect(normalizePhoneInput('8 (777) 123-45-67')).toBe('+77771234567');
    expect(normalizePhoneInput('+7 777 123 45 67')).toBe('+77771234567');
    expect(normalizePhoneInput('7771234567')).toBe('+77771234567');
    expect(isPhoneComplete('8 777 123 45 67')).toBe(true);
    expect(isPhoneComplete('+7 777 123')).toBe(false);
  });
});

const draft: PhoneOrderDraft = {
  branchId: 'b1',
  type: 'delivery',
  cart: addLine([], plov),
  point: { lat: 51.1, lng: 71.4 },
  promoCode: ' welcome10 ',
  certificateCode: '',
  phone: '8 777 123 45 67',
};

const details: PhoneOrderDetails = {
  name: ' Айгерим ',
  email: '',
  addressText: ' пр. Кабанбай батыра, 56 ',
  apartment: '12',
  entrance: '',
  floor: '3',
  intercom: '',
  courierComment: '',
  contactless: true,
  comment: '',
  paymentMethod: 'on_receipt',
  scheduledFor: null,
  consent: true,
  marketing: false,
  locale: 'kk',
};

describe('запросы расчёта и оформления (без сумм на клиенте)', () => {
  it('расчёт: только id и количества; точка — только для доставки', () => {
    expect(buildQuoteInput(draft)).toEqual({
      branchId: 'b1',
      type: 'delivery',
      items: [{ dishId: 'd1', quantity: 1, modifierOptionIds: ['o2', 'o1'] }],
      point: { lat: 51.1, lng: 71.4 },
      promoCode: 'welcome10',
      certificateCode: null,
      phone: '+77771234567',
    });
    expect(buildQuoteInput({ ...draft, type: 'pickup' })?.point).toBeNull();
    expect(buildQuoteInput({ ...draft, cart: [] })).toBeNull();
    expect(buildQuoteInput({ ...draft, phone: '+7 777' })?.phone).toBeNull();
  });

  it('оформление: адрес доставки, контакты, согласие, ключ идемпотентности', () => {
    const input = buildCreateInput(draft, details, 'admin-key-123');
    expect(input).toMatchObject({
      branchId: 'b1',
      type: 'delivery',
      delivery: { point: { lat: 51.1, lng: 71.4 }, addressText: 'пр. Кабанбай батыра, 56', apartment: '12', entrance: null, floor: '3' },
      contactless: true,
      scheduledFor: null,
      customer: { name: 'Айгерим', phone: '+77771234567', email: null },
      promoCode: 'welcome10',
      paymentMethod: 'on_receipt',
      consent: { personalData: true, marketing: null },
      locale: 'kk',
      idempotencyKey: 'admin-key-123',
    });
    const pickup = buildCreateInput({ ...draft, type: 'pickup' }, details, 'admin-key-123');
    expect(pickup.delivery).toBeNull();
    expect(pickup.contactless).toBe(false);
  });

  it('что осталось заполнить оператору', () => {
    expect(checkoutChecks(draft, { ...details, scheduled: false }, undefined)).toEqual(['quote']);
    expect(
      checkoutChecks({ ...draft, cart: [], point: null, phone: '' }, { name: '', addressText: '', consent: false, scheduledFor: null, scheduled: true }, undefined),
    ).toEqual(['items', 'phone', 'name', 'address', 'slot', 'consent']);
  });

  it('ключ идемпотентности подходит под правило сервера', () => {
    expect(newIdempotencyKey()).toMatch(/^[A-Za-z0-9_:.-]{8,128}$/);
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey());
  });
});

describe('модификаторы', () => {
  const groups: PublicModifierGroup[] = [
    {
      id: 'size',
      name: 'Размер',
      description: '',
      minSelect: 1,
      maxSelect: 1,
      isRequired: true,
      options: [
        { id: 's', name: 'Стандарт', price: { amount: 0, currency: 'KZT' }, isDefault: true },
        { id: 'l', name: 'Большой', price: { amount: 50_000, currency: 'KZT' }, isDefault: false },
      ],
    },
    {
      id: 'extra',
      name: 'Добавки',
      description: '',
      minSelect: 0,
      maxSelect: 2,
      isRequired: false,
      options: [
        { id: 'e1', name: 'Сыр', price: { amount: 30_000, currency: 'KZT' }, isDefault: false },
        { id: 'e2', name: 'Соус', price: { amount: 10_000, currency: 'KZT' }, isDefault: false },
        { id: 'e3', name: 'Лук', price: { amount: 0, currency: 'KZT' }, isDefault: false },
      ],
    },
  ];

  it('по умолчанию и проверка границ выбора', () => {
    const selection = defaultModifierSelection(groups);
    expect(selection).toEqual({ size: ['s'], extra: [] });
    expect(modifierIssues(groups, selection)).toEqual({});
    expect(modifierIssues(groups, { size: [], extra: ['e1', 'e2', 'e3'] })).toEqual({ size: 'too_few', extra: 'too_many' });
  });

  it('выбранные опции в порядке меню', () => {
    expect(selectedOptions(groups, { size: ['l'], extra: ['e2', 'e1'] })).toEqual({ optionIds: ['l', 'e1', 'e2'], labels: ['Большой', 'Сыр', 'Соус'] });
  });
});
