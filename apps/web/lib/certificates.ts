/**
 * Покупка подарочного сертификата: модель формы, проверка заполнения и тело запроса
 * POST /api/v1/public/certificates/purchase. Проверки здесь — только удобство формы
 * (обязательные поля, формат почты, согласие); правила (телефон +7, канал доставки, лимиты)
 * окончательно проверяет сервер, его ошибки сопоставляются полям (fieldForApiError).
 */
import type { ApiError } from '@aula/api-client';
import type { PurchaseCertificateBody } from './api-types';
import { isSafePaymentUrl } from './payment-flow';
import { isEmailLike, isPhoneLike } from './validation';

export { isEmailLike, isPhoneLike, isSafePaymentUrl };

export type DeliveryChannel = 'email' | 'whatsapp';
export const DELIVERY_CHANNELS: readonly DeliveryChannel[] = ['email', 'whatsapp'];

export const LIMITS = {
  nameMax: 120,
  buyerNameMin: 2,
  emailMax: 200,
  phoneMax: 32,
  messageMax: 500,
  quantityMin: 1,
  /** На сайте — до 10 сертификатов за покупку (certificate_order.quantity_invalid). */
  quantityMax: 10,
} as const;

export interface CertificateFormValues {
  productId: string;
  quantity: number;
  buyerName: string;
  buyerPhone: string;
  buyerEmail: string;
  recipientName: string;
  recipientEmail: string;
  recipientPhone: string;
  message: string;
  deliveryChannel: DeliveryChannel;
  consentPersonalData: boolean;
  consentMarketing: boolean;
}

export type CertificateField = keyof CertificateFormValues;
export type FieldErrorCode = 'required' | 'tooShort' | 'tooLong' | 'email' | 'phone' | 'quantity' | 'consent' | 'product';
export type CertificateFormErrors = Partial<Record<CertificateField, FieldErrorCode>>;

export function emptyCertificateForm(productId = ''): CertificateFormValues {
  return {
    productId,
    quantity: 1,
    buyerName: '',
    buyerPhone: '',
    buyerEmail: '',
    recipientName: '',
    recipientEmail: '',
    recipientPhone: '',
    message: '',
    deliveryChannel: 'email',
    consentPersonalData: false,
    consentMarketing: false,
  };
}

/** Поля по порядку в форме — для фокуса на первой ошибке. */
export const FIELD_ORDER: readonly CertificateField[] = [
  'productId',
  'quantity',
  'buyerName',
  'buyerPhone',
  'buyerEmail',
  'recipientName',
  'recipientEmail',
  'recipientPhone',
  'message',
  'deliveryChannel',
  'consentPersonalData',
];

export function validateCertificateForm(values: CertificateFormValues): CertificateFormErrors {
  const errors: CertificateFormErrors = {};
  if (!values.productId) errors.productId = 'product';
  if (!Number.isInteger(values.quantity) || values.quantity < LIMITS.quantityMin || values.quantity > LIMITS.quantityMax) {
    errors.quantity = 'quantity';
  }

  const buyerName = values.buyerName.trim();
  if (!buyerName) errors.buyerName = 'required';
  else if (buyerName.length < LIMITS.buyerNameMin) errors.buyerName = 'tooShort';
  else if (buyerName.length > LIMITS.nameMax) errors.buyerName = 'tooLong';

  if (!values.buyerPhone.trim()) errors.buyerPhone = 'required';
  else if (values.buyerPhone.length > LIMITS.phoneMax || !isPhoneLike(values.buyerPhone)) errors.buyerPhone = 'phone';

  if (!values.buyerEmail.trim()) errors.buyerEmail = 'required';
  else if (values.buyerEmail.trim().length > LIMITS.emailMax || !isEmailLike(values.buyerEmail)) errors.buyerEmail = 'email';

  const recipientName = values.recipientName.trim();
  if (!recipientName) errors.recipientName = 'required';
  else if (recipientName.length > LIMITS.nameMax) errors.recipientName = 'tooLong';

  if (values.recipientEmail.trim() && (values.recipientEmail.trim().length > LIMITS.emailMax || !isEmailLike(values.recipientEmail))) {
    errors.recipientEmail = 'email';
  }
  if (values.recipientPhone.trim() && (values.recipientPhone.length > LIMITS.phoneMax || !isPhoneLike(values.recipientPhone))) {
    errors.recipientPhone = 'phone';
  }
  if (values.message.length > LIMITS.messageMax) errors.message = 'tooLong';
  if (values.consentPersonalData !== true) errors.consentPersonalData = 'consent';
  return errors;
}

export function firstErrorField(errors: CertificateFormErrors): CertificateField | null {
  return FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

export function toPurchaseBody(
  values: CertificateFormValues,
  context: { locale: 'kk' | 'ru' | 'en'; idempotencyKey: string },
): PurchaseCertificateBody {
  const recipientEmail = values.recipientEmail.trim();
  const recipientPhone = values.recipientPhone.trim();
  const message = values.message.trim();
  return {
    productId: values.productId,
    quantity: values.quantity,
    buyer: { name: values.buyerName.trim(), phone: values.buyerPhone.trim(), email: values.buyerEmail.trim() },
    recipient: {
      name: values.recipientName.trim(),
      ...(recipientEmail ? { email: recipientEmail } : {}),
      ...(recipientPhone ? { phone: recipientPhone } : {}),
    },
    ...(message ? { message } : {}),
    deliveryChannel: values.deliveryChannel,
    consent: { personalData: values.consentPersonalData, ...(values.consentMarketing ? { marketing: true } : {}) },
    locale: context.locale,
    idempotencyKey: context.idempotencyKey,
  };
}

/** Ошибка сервера → поле формы (подсветить и сфокусировать). null — общая ошибка формы. */
export function fieldForApiError(error: ApiError, values: CertificateFormValues): CertificateField | null {
  switch (error.code) {
    case 'consent.required':
      return 'consentPersonalData';
    case 'certificate_order.quantity_invalid':
      return 'quantity';
    case 'certificate_order.email_required':
      return 'recipientEmail';
    case 'certificate_order.phone_required':
      return 'recipientPhone';
    case 'certificate_product.not_found':
    case 'certificate_product.inactive':
    case 'certificate_product.not_for_sale':
      return 'productId';
    case 'phone.invalid': {
      const phone = typeof error.details.phone === 'string' ? error.details.phone : null;
      return phone !== null && phone === values.recipientPhone.trim() && phone !== values.buyerPhone.trim() ? 'recipientPhone' : 'buyerPhone';
    }
    default:
      return null;
  }
}

/** Код ошибки сервера → код ошибки поля для подписи. */
export function fieldErrorForApiError(error: ApiError): FieldErrorCode {
  switch (error.code) {
    case 'consent.required':
      return 'consent';
    case 'certificate_order.quantity_invalid':
      return 'quantity';
    case 'phone.invalid':
    case 'certificate_order.phone_required':
      return 'phone';
    case 'certificate_order.email_required':
      return 'email';
    default:
      return 'product';
  }
}

// ---------------------------------------------------------------- Статус заказа сертификата

export type CertificateOrderPhase = 'preparing' | 'awaiting' | 'issued' | 'failed' | 'cancelled';

/**
 * Что показать на странице заказа по ответу GET /public/certificates/orders/{token}.
 * Статусы считает сервер; здесь — только выбор экрана.
 */
export function certificateOrderPhase(order: {
  status: string;
  payment?: { status: string; paymentUrl?: string | null } | null;
}): CertificateOrderPhase {
  if (order.status === 'issued') return 'issued';
  if (order.status === 'payment_failed' || order.payment?.status === 'failed') return 'failed';
  if (order.payment?.status === 'cancelled') return 'cancelled';
  return order.payment?.paymentUrl ? 'awaiting' : 'preparing';
}

/** Экран, на котором опрос статуса продолжается. */
export function isPendingPhase(phase: CertificateOrderPhase): boolean {
  return phase === 'preparing' || phase === 'awaiting';
}

// ---------------------------------------------------------------- Код сертификата

/** Длина кода без дефисов (XXXX-XXXX-XXXX). */
export const CERTIFICATE_CODE_LENGTH = 12;

/** Ввод кода → «XXXX-XXXX-XXXX»: верхний регистр, только буквы и цифры, дефисы через 4 символа. */
export function formatCertificateCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CERTIFICATE_CODE_LENGTH);
  return raw.replace(/(.{4})(?=.)/g, '$1-');
}

export function isCompleteCertificateCode(code: string): boolean {
  return code.replace(/[^A-Z0-9]/gi, '').length === CERTIFICATE_CODE_LENGTH;
}
