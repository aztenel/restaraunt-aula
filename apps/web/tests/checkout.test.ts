import { describe, expect, it } from 'vitest';
import type { DeliveryOption, DeliveryResolution } from '@/lib/api-types';
import {
  advance,
  checkoutErrorTarget,
  checkoutReducer,
  deliveryDecision,
  initialCheckoutState,
  parseDraft,
  pointKey,
  readyToSubmit,
  toCheckoutBody,
  toDraft,
  validateDetails,
  validatePayment,
  type CheckoutContext,
  type CheckoutState,
} from '@/lib/checkout';

const PICKUP_CTX: CheckoutContext = { acceptedTypes: ['pickup', 'delivery'], deliverable: null, paymentMethods: ['online', 'on_receipt'] };
const POINT = { lat: 51.1282, lng: 71.4304 };

function filledPickup(): CheckoutState {
  let s = initialCheckoutState('pickup');
  s = checkoutReducer(s, { type: 'setCustomer', patch: { name: 'Айгерим', phone: '+7 701 123 45 67' } });
  s = checkoutReducer(s, { type: 'setConsent', personalData: true });
  return s;
}

function filledDelivery(): CheckoutState {
  let s = checkoutReducer(filledPickup(), { type: 'setOrderType', orderType: 'delivery' });
  s = checkoutReducer(s, { type: 'setAddress', patch: { addressText: 'Кенесары, 40', point: POINT, apartment: ' 12 ' } });
  return s;
}

describe('оформление: состояние и переходы', () => {
  it('смена способа получения сбрасывает выбранное время', () => {
    let s = initialCheckoutState('pickup');
    s = checkoutReducer(s, { type: 'setScheduledDate', date: '2026-10-01' });
    s = checkoutReducer(s, { type: 'setScheduledFor', at: '2026-10-01T13:00:00.000Z' });
    expect(s.timeMode).toBe('scheduled');
    const same = checkoutReducer(s, { type: 'setOrderType', orderType: 'pickup' });
    expect(same).toBe(s);
    const next = checkoutReducer(s, { type: 'setOrderType', orderType: 'delivery' });
    expect(next).toMatchObject({ type: 'delivery', timeMode: 'asap', scheduledDate: null, scheduledFor: null });
  });

  it('новая дата сбрасывает слот, «как можно скорее» — тоже', () => {
    let s = checkoutReducer(initialCheckoutState(), { type: 'setScheduledFor', at: '2026-10-01T13:00:00.000Z' });
    s = checkoutReducer(s, { type: 'setScheduledDate', date: '2026-10-02' });
    expect(s.scheduledFor).toBeNull();
    s = checkoutReducer(s, { type: 'setScheduledFor', at: '2026-10-02T13:00:00.000Z' });
    s = checkoutReducer(s, { type: 'setAsap' });
    expect(s).toMatchObject({ timeMode: 'asap', scheduledFor: null });
  });

  it('подтверждение телефона сбрасывается, если номер изменили', () => {
    let s = checkoutReducer(filledPickup(), { type: 'setVerification', verification: { token: 't', phone: '+77011234567', expiresAt: 'x' } });
    s = checkoutReducer(s, { type: 'setCustomer', patch: { phone: '8 (701) 123-45-67' } });
    expect(s.verification?.token).toBe('t');
    s = checkoutReducer(s, { type: 'setCustomer', patch: { name: 'Айгерим Н.' } });
    expect(s.verification?.token).toBe('t');
    s = checkoutReducer(s, { type: 'setCustomer', patch: { phone: '+7 702 000 00 00' } });
    expect(s.verification).toBeNull();
  });

  it('коды промо и сертификата — без пробелов, в верхнем регистре', () => {
    let s = checkoutReducer(initialCheckoutState(), { type: 'applyPromo', code: '  welcome10 ' });
    s = checkoutReducer(s, { type: 'applyCertificate', code: 'abcd-efgh-jkmn' });
    expect(s.promoCode).toBe('WELCOME10');
    expect(s.certificateCode).toBe('ABCD-EFGH-JKMN');
  });

  it('«Данные» не пропускают дальше без имени, телефона и согласия', () => {
    const { state, errors } = advance(initialCheckoutState('pickup'), PICKUP_CTX);
    expect(state.step).toBe('details');
    expect(errors).toMatchObject({ name: 'required', phone: 'required', consentPersonalData: 'consent' });
  });

  it('доставка требует адрес и проверенную точку в зоне', () => {
    let s = checkoutReducer(filledPickup(), { type: 'setOrderType', orderType: 'delivery' });
    expect(validateDetails(s, PICKUP_CTX)).toMatchObject({ addressText: 'required', point: 'required' });
    s = checkoutReducer(s, { type: 'setAddress', patch: { addressText: 'Кенесары, 40', point: POINT } });
    // Точка есть, но сервер ещё не ответил.
    expect(validateDetails(s, { ...PICKUP_CTX, deliverable: null }).point).toBe('required');
    expect(validateDetails(s, { ...PICKUP_CTX, deliverable: false }).point).toBe('invalid');
    expect(validateDetails(s, { ...PICKUP_CTX, deliverable: true })).toEqual({});
  });

  it('способ получения, который филиал не принимает, — ошибка', () => {
    expect(validateDetails(filledPickup(), { ...PICKUP_CTX, acceptedTypes: ['delivery'] }).type).toBe('invalid');
  });

  it('время: слот обязателен в режиме «ко времени», «как можно скорее» — если доступно', () => {
    const s = checkoutReducer(filledPickup(), { type: 'setScheduledDate', date: '2026-10-01' });
    expect(validateDetails(s, PICKUP_CTX).time).toBe('required');
    expect(validateDetails(filledPickup(), { ...PICKUP_CTX, asapAvailable: false }).time).toBe('invalid');
    expect(validateDetails(filledPickup(), { ...PICKUP_CTX, asapAvailable: true }).time).toBeUndefined();
  });

  it('переход на «Оплату» выбирает первый разрешённый способ оплаты', () => {
    const { state, errors } = advance(filledPickup(), { ...PICKUP_CTX, paymentMethods: ['on_receipt'] });
    expect(errors).toEqual({});
    expect(state).toMatchObject({ step: 'payment', paymentMethod: 'on_receipt' });
    // Уже выбранный и разрешённый способ сохраняется.
    const chosen = checkoutReducer(filledPickup(), { type: 'setPaymentMethod', method: 'online' });
    expect(advance(chosen, PICKUP_CTX).state.paymentMethod).toBe('online');
  });

  it('«Оплата»: способ обязателен и должен быть разрешён филиалом', () => {
    const s = advance(filledPickup(), PICKUP_CTX).state;
    expect(validatePayment(s, PICKUP_CTX)).toEqual({});
    expect(validatePayment(s, { ...PICKUP_CTX, paymentMethods: ['on_receipt'] }).paymentMethod).toBe('required');
    expect(readyToSubmit(s, PICKUP_CTX)).toBe(true);
    expect(readyToSubmit(initialCheckoutState(), PICKUP_CTX)).toBe(false);
  });
});

describe('оформление: адрес → филиал', () => {
  const option = (branchId: string): DeliveryOption =>
    ({ branch: { id: branchId, slug: branchId, name: branchId }, zone: { id: `z-${branchId}` } }) as unknown as DeliveryOption;
  const resolution = (best: DeliveryOption | null, alternatives: DeliveryOption[] = []) =>
    ({ deliverable: best !== null, best, alternatives }) as Pick<DeliveryResolution, 'deliverable' | 'best' | 'alternatives'>;

  it('остаёмся в текущем филиале, если его зона покрывает точку', () => {
    expect(deliveryDecision(resolution(option('b2'), [option('b1')]), 'b1')).toEqual({ status: 'deliverable', option: option('b1') });
  });

  it('иначе предлагаем лучший филиал', () => {
    expect(deliveryDecision(resolution(option('b2')), 'b1')).toEqual({ status: 'switch', option: option('b2') });
  });

  it('не доставляем — никаких вариантов', () => {
    expect(deliveryDecision(resolution(null), 'b1')).toEqual({ status: 'not_deliverable' });
  });

  it('ключ точки учитывает филиал', () => {
    expect(pointKey(null, 'b1')).toBeNull();
    expect(pointKey(POINT, 'b1')).not.toBe(pointKey(POINT, 'b2'));
  });
});

describe('оформление: тело заказа', () => {
  const context = {
    branchId: 'b1',
    items: [{ dishId: 'd1', quantity: 2, modifierOptionIds: ['m1'] }],
    locale: 'ru' as const,
    idempotencyKey: 'key-1',
    analyticsSessionId: 'sess',
  };

  it('самовывоз: без адреса, без бесконтактной доставки, пустые поля → null', () => {
    const s = checkoutReducer(advance(filledPickup(), PICKUP_CTX).state, { type: 'setContactless', value: true });
    const body = toCheckoutBody(s, context);
    expect(body).toMatchObject({
      branchId: 'b1',
      type: 'pickup',
      delivery: null,
      contactless: false,
      scheduledFor: null,
      customer: { name: 'Айгерим', phone: '+7 701 123 45 67', email: null },
      comment: null,
      promoCode: null,
      certificateCode: null,
      paymentMethod: 'online',
      phoneVerificationToken: null,
      consent: { personalData: true, marketing: false },
      locale: 'ru',
      idempotencyKey: 'key-1',
    });
    expect(body.items).toEqual([{ dishId: 'd1', quantity: 2, modifierOptionIds: ['m1'] }]);
    // Денег в теле заказа нет — их считает сервер.
    expect(JSON.stringify(body)).not.toMatch(/amount|price|total/i);
  });

  it('доставка ко времени с кодами и подтверждённым телефоном', () => {
    let s = filledDelivery();
    s = checkoutReducer(s, { type: 'setContactless', value: true });
    s = checkoutReducer(s, { type: 'setScheduledDate', date: '2026-10-01' });
    s = checkoutReducer(s, { type: 'setScheduledFor', at: '2026-10-01T13:00:00.000Z' });
    s = checkoutReducer(s, { type: 'setPaymentMethod', method: 'on_receipt' });
    s = checkoutReducer(s, { type: 'applyPromo', code: 'welcome10' });
    s = checkoutReducer(s, { type: 'setVerification', verification: { token: 'vt', phone: '+77011234567', expiresAt: 'x' } });
    const body = toCheckoutBody(s, context);
    expect(body).toMatchObject({
      type: 'delivery',
      delivery: { point: POINT, addressText: 'Кенесары, 40', apartment: '12' },
      contactless: true,
      scheduledFor: '2026-10-01T13:00:00.000Z',
      paymentMethod: 'on_receipt',
      promoCode: 'WELCOME10',
      phoneVerificationToken: 'vt',
    });
    expect(body.delivery?.entrance).toBeUndefined();
  });
});

describe('оформление: ошибки сервера → экран и поле', () => {
  it.each([
    ['phone.not_verified', { step: 'payment', field: null, needsVerification: true, cart: false }],
    ['phone.invalid', { step: 'details', field: 'phone' }],
    ['order.consent_required', { step: 'details', field: 'consentPersonalData' }],
    ['order.address_not_deliverable', { step: 'details', field: 'point' }],
    ['order.schedule_too_early', { step: 'details', field: 'time' }],
    ['order.branch_closed', { step: 'details', field: 'time' }],
    ['order.payment_method_not_accepted', { step: 'payment', field: 'paymentMethod' }],
    ['promo.expired', { step: 'payment', field: 'promoCode' }],
    ['order.certificate_empty', { step: 'payment', field: 'certificateCode' }],
    ['catalog.dish_unavailable', { cart: true }],
    ['order.min_order_not_reached', { cart: true }],
    ['something.else', { step: 'payment', field: null, needsVerification: false, cart: false }],
  ])('%s', (code, expected) => {
    expect(checkoutErrorTarget({ code })).toMatchObject(expected);
  });
});

describe('оформление: черновик', () => {
  it('сохраняет данные без согласий и подтверждения, восстанавливает их', () => {
    const s = checkoutReducer(filledDelivery(), { type: 'setVerification', verification: { token: 'vt', phone: '+77011234567', expiresAt: 'x' } });
    const draft = parseDraft(JSON.stringify(toDraft(s)));
    expect(draft).not.toBeNull();
    expect(draft).not.toHaveProperty('consentPersonalData');
    expect(draft).not.toHaveProperty('verification');
    const restored = checkoutReducer(initialCheckoutState(), { type: 'restore', draft: draft! });
    expect(restored).toMatchObject({ type: 'delivery', address: { addressText: 'Кенесары, 40', point: POINT }, consentPersonalData: false, verification: null });
  });

  it('повреждённый черновик игнорируется, лишнее отбрасывается', () => {
    expect(parseDraft('{oops')).toBeNull();
    expect(parseDraft(null)).toBeNull();
    const draft = parseDraft(JSON.stringify({ type: 'teleport', address: { point: { lat: 'x' } }, paymentMethod: 'crypto', customer: { name: 5 } }));
    expect(draft).toMatchObject({ type: 'pickup', address: { point: null }, paymentMethod: null, customer: { name: '' } });
  });
});
