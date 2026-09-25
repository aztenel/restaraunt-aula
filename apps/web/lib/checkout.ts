/**
 * Оформление заказа (ТЗ: не больше 4 экранов): корзина → «Данные» → «Оплата» → статус заказа.
 * Здесь — состояние формы, переходы между экранами, проверки заполнения и тело
 * POST /api/v1/public/orders. Денег здесь нет: суммы, доставку, минимальную сумму, промокод
 * и сертификат считает сервер (расчёт на каждом шаге и при оформлении).
 */
import type { ApiError } from '@aula/api-client';
import type { CheckoutBody, GeoPoint, OrderType } from './api-types';
import { comparablePhone, hasErrors, validateContact, type ContactValues, type FormErrors } from './validation';

export type CheckoutStep = 'details' | 'payment';
export const CHECKOUT_STEPS: readonly CheckoutStep[] = ['details', 'payment'];
export type TimeMode = 'asap' | 'scheduled';
export type PaymentMethod = 'online' | 'on_receipt';

export const CHECKOUT_LIMITS = {
  nameMax: 100,
  addressMin: 3,
  addressMax: 500,
  addressPartMax: 50,
  courierCommentMax: 500,
  commentMax: 1000,
  codeMax: 32,
} as const;

export interface DeliveryAddress {
  point: GeoPoint | null;
  addressText: string;
  apartment: string;
  entrance: string;
  floor: string;
  intercom: string;
  courierComment: string;
}

export interface PhoneVerificationToken {
  token: string;
  /** Номер, который подтверждён (+7XXXXXXXXXX). */
  phone: string;
  expiresAt: string;
}

export interface CheckoutState {
  step: CheckoutStep;
  type: OrderType;
  address: DeliveryAddress;
  contactless: boolean;
  timeMode: TimeMode;
  /** Локальная дата филиала (YYYY-MM-DD) для выбора слота. */
  scheduledDate: string | null;
  /** Момент слота (ISO UTC от сервера) — уходит в scheduledFor. */
  scheduledFor: string | null;
  customer: ContactValues;
  comment: string;
  consentPersonalData: boolean;
  consentMarketing: boolean;
  paymentMethod: PaymentMethod | null;
  /** Применённые коды (уходят в расчёт и в заказ). */
  promoCode: string;
  certificateCode: string;
  verification: PhoneVerificationToken | null;
}

export const EMPTY_ADDRESS: DeliveryAddress = {
  point: null,
  addressText: '',
  apartment: '',
  entrance: '',
  floor: '',
  intercom: '',
  courierComment: '',
};

export function initialCheckoutState(type: OrderType = 'pickup'): CheckoutState {
  return {
    step: 'details',
    type,
    address: { ...EMPTY_ADDRESS },
    contactless: false,
    timeMode: 'asap',
    scheduledDate: null,
    scheduledFor: null,
    customer: { name: '', phone: '', email: '' },
    comment: '',
    consentPersonalData: false,
    consentMarketing: false,
    paymentMethod: null,
    promoCode: '',
    certificateCode: '',
    verification: null,
  };
}

export type CheckoutAction =
  | { type: 'setOrderType'; orderType: OrderType }
  | { type: 'setAddress'; patch: Partial<DeliveryAddress> }
  | { type: 'setContactless'; value: boolean }
  | { type: 'setAsap' }
  | { type: 'setScheduledDate'; date: string | null }
  | { type: 'setScheduledFor'; at: string | null }
  | { type: 'setCustomer'; patch: Partial<ContactValues> }
  | { type: 'setComment'; value: string }
  | { type: 'setConsent'; personalData?: boolean; marketing?: boolean }
  | { type: 'setPaymentMethod'; method: PaymentMethod | null }
  | { type: 'applyPromo'; code: string }
  | { type: 'applyCertificate'; code: string }
  | { type: 'setVerification'; verification: PhoneVerificationToken | null }
  | { type: 'goTo'; step: CheckoutStep }
  | { type: 'restore'; draft: CheckoutDraft };

export function checkoutReducer(state: CheckoutState, action: CheckoutAction): CheckoutState {
  switch (action.type) {
    case 'setOrderType':
      if (state.type === action.orderType) return state;
      // Слоты времени зависят от способа получения — выбор времени начинается заново.
      return { ...state, type: action.orderType, timeMode: 'asap', scheduledDate: null, scheduledFor: null };
    case 'setAddress':
      return { ...state, address: { ...state.address, ...action.patch } };
    case 'setContactless':
      return { ...state, contactless: action.value };
    case 'setAsap':
      return { ...state, timeMode: 'asap', scheduledFor: null };
    case 'setScheduledDate':
      return { ...state, timeMode: 'scheduled', scheduledDate: action.date, scheduledFor: null };
    case 'setScheduledFor':
      return { ...state, timeMode: 'scheduled', scheduledFor: action.at };
    case 'setCustomer': {
      const customer = { ...state.customer, ...action.patch };
      // Подтверждение действует только для того номера, который подтверждали.
      const verification =
        state.verification && comparablePhone(customer.phone) !== state.verification.phone ? null : state.verification;
      return { ...state, customer, verification };
    }
    case 'setComment':
      return { ...state, comment: action.value };
    case 'setConsent':
      return {
        ...state,
        consentPersonalData: action.personalData ?? state.consentPersonalData,
        consentMarketing: action.marketing ?? state.consentMarketing,
      };
    case 'setPaymentMethod':
      return { ...state, paymentMethod: action.method };
    case 'applyPromo':
      return { ...state, promoCode: action.code.trim().toUpperCase().slice(0, CHECKOUT_LIMITS.codeMax) };
    case 'applyCertificate':
      return { ...state, certificateCode: action.code.trim().toUpperCase().slice(0, CHECKOUT_LIMITS.codeMax) };
    case 'setVerification':
      return { ...state, verification: action.verification };
    case 'goTo':
      return state.step === action.step ? state : { ...state, step: action.step };
    case 'restore':
      return { ...state, ...action.draft, address: { ...state.address, ...action.draft.address }, customer: { ...state.customer, ...action.draft.customer } };
    default:
      return state;
  }
}

// ---------------------------------------------------------------- Проверки экранов

/** Что известно странице о филиале и адресе (из API) — для проверок экранов. */
export interface CheckoutContext {
  acceptedTypes: readonly OrderType[];
  /** Доставка в точку: true/false — ответ POST /public/delivery/resolve; null — ещё не проверено. */
  deliverable: boolean | null;
  paymentMethods: readonly PaymentMethod[];
}

export type DetailsField =
  | 'type'
  | 'addressText'
  | 'point'
  | 'apartment'
  | 'entrance'
  | 'floor'
  | 'intercom'
  | 'courierComment'
  | 'time'
  | 'name'
  | 'phone'
  | 'email'
  | 'comment'
  | 'consentPersonalData';

export const DETAILS_FIELD_ORDER: readonly DetailsField[] = [
  'type',
  'addressText',
  'point',
  'apartment',
  'entrance',
  'floor',
  'intercom',
  'courierComment',
  'time',
  'name',
  'phone',
  'email',
  'comment',
  'consentPersonalData',
];

export type PaymentField = 'paymentMethod' | 'promoCode' | 'certificateCode';
export const PAYMENT_FIELD_ORDER: readonly PaymentField[] = ['paymentMethod', 'promoCode', 'certificateCode'];

export function validateDetails(state: CheckoutState, ctx: CheckoutContext): FormErrors<DetailsField> {
  const errors: FormErrors<DetailsField> = {};
  if (!ctx.acceptedTypes.includes(state.type)) errors.type = 'invalid';
  if (state.type === 'delivery') {
    const address = state.address.addressText.trim();
    if (!address) errors.addressText = 'required';
    else if (address.length < CHECKOUT_LIMITS.addressMin) errors.addressText = 'tooShort';
    else if (address.length > CHECKOUT_LIMITS.addressMax) errors.addressText = 'tooLong';
    if (!state.address.point || ctx.deliverable === null) errors.point = 'required';
    else if (ctx.deliverable === false) errors.point = 'invalid';
    for (const part of ['apartment', 'entrance', 'floor', 'intercom'] as const) {
      if (state.address[part].trim().length > CHECKOUT_LIMITS.addressPartMax) errors[part] = 'tooLong';
    }
    if (state.address.courierComment.trim().length > CHECKOUT_LIMITS.courierCommentMax) errors.courierComment = 'tooLong';
  }
  if (state.timeMode === 'scheduled' && !state.scheduledFor) errors.time = 'required';
  Object.assign(errors, validateContact(state.customer, { nameMax: CHECKOUT_LIMITS.nameMax }));
  if (state.comment.trim().length > CHECKOUT_LIMITS.commentMax) errors.comment = 'tooLong';
  if (!state.consentPersonalData) errors.consentPersonalData = 'consent';
  return errors;
}

export function validatePayment(state: CheckoutState, ctx: CheckoutContext): FormErrors<PaymentField> {
  const errors: FormErrors<PaymentField> = {};
  if (!state.paymentMethod || !ctx.paymentMethods.includes(state.paymentMethod)) errors.paymentMethod = 'required';
  if (state.promoCode.length > CHECKOUT_LIMITS.codeMax) errors.promoCode = 'tooLong';
  if (state.certificateCode.length > CHECKOUT_LIMITS.codeMax) errors.certificateCode = 'tooLong';
  return errors;
}

/**
 * «Далее»: с «Данных» на «Оплату» — только если экран заполнен. Возвращает новое состояние
 * (или прежнее) и ошибки текущего экрана.
 */
export function advance(
  state: CheckoutState,
  ctx: CheckoutContext,
): { state: CheckoutState; errors: FormErrors<DetailsField> } {
  if (state.step !== 'details') return { state, errors: {} };
  const errors = validateDetails(state, ctx);
  if (hasErrors(errors)) return { state, errors };
  // Способ оплаты по умолчанию — первый разрешённый филиалом (если прежний выбор больше не разрешён).
  const paymentMethod = state.paymentMethod && ctx.paymentMethods.includes(state.paymentMethod) ? state.paymentMethod : (ctx.paymentMethods[0] ?? null);
  return { state: { ...state, step: 'payment', paymentMethod }, errors };
}

/** Можно ли отправлять заказ: оба экрана заполнены. */
export function readyToSubmit(state: CheckoutState, ctx: CheckoutContext): boolean {
  return !hasErrors(validateDetails(state, ctx)) && !hasErrors(validatePayment(state, ctx));
}

// ---------------------------------------------------------------- Тело заказа

function optional(value: string): string | undefined {
  const text = value.trim();
  return text ? text : undefined;
}

export function toCheckoutBody(
  state: CheckoutState,
  context: {
    branchId: string;
    items: Array<{ dishId: string; quantity: number; modifierOptionIds: string[] }>;
    locale: 'kk' | 'ru' | 'en';
    idempotencyKey: string;
    analyticsSessionId: string | null;
  },
): CheckoutBody {
  const delivery = state.type === 'delivery' && state.address.point
    ? {
        point: { lat: state.address.point.lat, lng: state.address.point.lng },
        addressText: state.address.addressText.trim(),
        apartment: optional(state.address.apartment),
        entrance: optional(state.address.entrance),
        floor: optional(state.address.floor),
        intercom: optional(state.address.intercom),
        courierComment: optional(state.address.courierComment),
      }
    : null;
  return {
    branchId: context.branchId,
    type: state.type,
    items: context.items.map(({ dishId, quantity, modifierOptionIds }) => ({ dishId, quantity, modifierOptionIds })),
    delivery,
    contactless: state.type === 'delivery' ? state.contactless : false,
    scheduledFor: state.timeMode === 'scheduled' ? state.scheduledFor : null,
    customer: { name: state.customer.name.trim(), phone: state.customer.phone.trim(), email: optional(state.customer.email) ?? null },
    comment: optional(state.comment) ?? null,
    promoCode: state.promoCode || null,
    certificateCode: state.certificateCode || null,
    paymentMethod: state.paymentMethod ?? 'online',
    phoneVerificationToken: state.verification?.token ?? null,
    consent: { personalData: state.consentPersonalData, marketing: state.consentMarketing },
    locale: context.locale,
    analyticsSessionId: context.analyticsSessionId,
    idempotencyKey: context.idempotencyKey,
  };
}

// ---------------------------------------------------------------- Ошибки оформления

export interface CheckoutErrorTarget {
  step: CheckoutStep;
  field: DetailsField | PaymentField | null;
  /** Сервер требует подтвердить телефон SMS-кодом (оплата при получении). */
  needsVerification: boolean;
  /** Проблема в составе корзины — вернуться в корзину. */
  cart: boolean;
}

/** Куда вести гостя по ошибке POST /public/orders: экран и поле. */
export function checkoutErrorTarget(error: Pick<ApiError, 'code'>): CheckoutErrorTarget {
  const code = error.code;
  const target = (step: CheckoutStep, field: CheckoutErrorTarget['field'], extra: Partial<CheckoutErrorTarget> = {}): CheckoutErrorTarget => ({
    step,
    field,
    needsVerification: false,
    cart: false,
    ...extra,
  });
  if (code === 'phone.not_verified') return target('payment', null, { needsVerification: true });
  if (code === 'phone.invalid') return target('details', 'phone');
  if (code === 'order.consent_required') return target('details', 'consentPersonalData');
  if (code === 'order.type_not_accepted') return target('details', 'type');
  if (['order.address_required', 'order.address_not_deliverable', 'order.delivery_required'].includes(code)) return target('details', 'point');
  if (code.startsWith('order.schedule_') || code === 'order.asap_closing_soon' || code === 'order.branch_closed') return target('details', 'time');
  if (code === 'order.payment_method_not_accepted') return target('payment', 'paymentMethod');
  if (code.startsWith('promo.')) return target('payment', 'promoCode');
  if (code.startsWith('order.certificate_') || code.startsWith('certificate.')) return target('payment', 'certificateCode');
  if (code.startsWith('catalog.') || code === 'order.empty' || code === 'order.too_many_lines') return target('payment', null, { cart: true });
  return target('payment', null);
}

// ---------------------------------------------------------------- Черновик (sessionStorage)

/** Сохраняется между перезагрузками вкладки: без согласий, кода подтверждения и шага. */
export type CheckoutDraft = Pick<CheckoutState, 'type' | 'address' | 'contactless' | 'customer' | 'comment' | 'paymentMethod'>;

export const CHECKOUT_DRAFT_KEY = 'aula_checkout_draft_v1';

export function toDraft(state: CheckoutState): CheckoutDraft {
  return {
    type: state.type,
    address: state.address,
    contactless: state.contactless,
    customer: state.customer,
    comment: state.comment,
    paymentMethod: state.paymentMethod,
  };
}

export function parseDraft(raw: string | null | undefined): CheckoutDraft | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<CheckoutDraft> | null;
    if (!data || typeof data !== 'object') return null;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const a = (data.address ?? {}) as Partial<DeliveryAddress>;
    const point =
      a.point && typeof a.point.lat === 'number' && typeof a.point.lng === 'number' && Number.isFinite(a.point.lat) && Number.isFinite(a.point.lng)
        ? { lat: a.point.lat, lng: a.point.lng }
        : null;
    const c = (data.customer ?? {}) as Partial<ContactValues>;
    return {
      type: data.type === 'delivery' ? 'delivery' : 'pickup',
      address: {
        point,
        addressText: str(a.addressText, CHECKOUT_LIMITS.addressMax),
        apartment: str(a.apartment, CHECKOUT_LIMITS.addressPartMax),
        entrance: str(a.entrance, CHECKOUT_LIMITS.addressPartMax),
        floor: str(a.floor, CHECKOUT_LIMITS.addressPartMax),
        intercom: str(a.intercom, CHECKOUT_LIMITS.addressPartMax),
        courierComment: str(a.courierComment, CHECKOUT_LIMITS.courierCommentMax),
      },
      contactless: data.contactless === true,
      customer: { name: str(c.name, CHECKOUT_LIMITS.nameMax), phone: str(c.phone, 32), email: str(c.email, 200) },
      comment: str(data.comment, CHECKOUT_LIMITS.commentMax),
      paymentMethod: data.paymentMethod === 'online' || data.paymentMethod === 'on_receipt' ? data.paymentMethod : null,
    };
  } catch {
    return null;
  }
}
