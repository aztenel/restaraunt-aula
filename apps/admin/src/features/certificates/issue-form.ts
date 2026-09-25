/**
 * Выпуск сертификатов по счёту (корпоративная продажа, банковский перевод): форма ⇄ ManualIssueDto.
 * Итог по договору необязателен — по умолчанию его считает сервер (цена × количество).
 * Правила — зеркало ManualIssueDto и проверок заказа сертификатов на сервере.
 */
import type { Dayjs } from 'dayjs';
import { startOfLocalDayIso } from '@/shared/lib/dates';
import type { ContentLocale, DeliveryChannel, ManualIssueBody } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface IssueFormValues {
  productId?: string;
  quantity: number | null;
  /** Итог по договору, тиыны; null — цена × количество (сервер). */
  total: number | null;
  buyerName: string;
  buyerCompany: string;
  buyerPhone: string;
  buyerEmail: string;
  /** Получатель — сам покупатель (по умолчанию). */
  recipientIsBuyer: boolean;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  message: string;
  deliveryChannel: DeliveryChannel;
  locale: ContentLocale;
  documentNumber: string;
  paidAt: Dayjs | null;
}

export type IssueFormIssue =
  | 'product_required'
  | 'quantity_range'
  | 'total_negative'
  | 'name_length'
  | 'email_invalid'
  | 'email_required'
  | 'phone_required'
  | 'document_required'
  | 'document_too_long'
  | 'paid_at_required'
  | 'paid_at_future'
  | 'message_too_long';

export type IssueFormErrors = Partial<
  Record<
    | 'productId'
    | 'quantity'
    | 'total'
    | 'buyerName'
    | 'buyerEmail'
    | 'buyerPhone'
    | 'recipientName'
    | 'recipientEmail'
    | 'recipientPhone'
    | 'documentNumber'
    | 'paidAt'
    | 'message',
    IssueFormIssue
  >
>;

export function emptyIssueForm(locale: ContentLocale = 'ru'): IssueFormValues {
  return {
    quantity: 1,
    total: null,
    buyerName: '',
    buyerCompany: '',
    buyerPhone: '',
    buyerEmail: '',
    recipientIsBuyer: true,
    recipientName: '',
    recipientPhone: '',
    recipientEmail: '',
    message: '',
    deliveryChannel: 'none',
    locale,
    documentNumber: '',
    paidAt: null,
  };
}

function nameIssue(value: string): IssueFormIssue | undefined {
  const length = value.trim().length;
  return length < 2 || length > 120 ? 'name_length' : undefined;
}

/**
 * Проверка формы. today — локальная дата сотрудника (YYYY-MM-DD, Asia/Almaty): дата поступления
 * не может быть в будущем.
 */
export function validateIssueForm(values: IssueFormValues, today: string): IssueFormErrors {
  const errors: IssueFormErrors = {};
  if (!values.productId) errors.productId = 'product_required';
  const quantity = values.quantity;
  if (quantity === null || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) errors.quantity = 'quantity_range';
  if (values.total !== null && values.total !== undefined && values.total < 0) errors.total = 'total_negative';

  const buyerName = nameIssue(values.buyerName);
  if (buyerName) errors.buyerName = buyerName;
  if (values.buyerEmail.trim() && !EMAIL_RE.test(values.buyerEmail.trim())) errors.buyerEmail = 'email_invalid';

  if (!values.recipientIsBuyer) {
    const recipientName = nameIssue(values.recipientName);
    if (recipientName) errors.recipientName = recipientName;
    if (values.recipientEmail.trim() && !EMAIL_RE.test(values.recipientEmail.trim())) errors.recipientEmail = 'email_invalid';
  }

  // Канал доставки требует контакт получателя (покупателя, если получатель — он сам).
  const email = (values.recipientIsBuyer ? values.buyerEmail : values.recipientEmail).trim();
  const phone = (values.recipientIsBuyer ? values.buyerPhone : values.recipientPhone).trim();
  const emailField = values.recipientIsBuyer ? 'buyerEmail' : 'recipientEmail';
  const phoneField = values.recipientIsBuyer ? 'buyerPhone' : 'recipientPhone';
  if (values.deliveryChannel === 'email' && !email && !errors[emailField]) errors[emailField] = 'email_required';
  if (values.deliveryChannel === 'whatsapp' && !phone) errors[phoneField] = 'phone_required';

  const document = values.documentNumber.trim();
  if (!document) errors.documentNumber = 'document_required';
  else if (document.length > 60) errors.documentNumber = 'document_too_long';

  if (!values.paidAt) errors.paidAt = 'paid_at_required';
  else if (values.paidAt.format('YYYY-MM-DD') > today) errors.paidAt = 'paid_at_future';

  if (values.message.trim().length > 500) errors.message = 'message_too_long';
  return errors;
}

function optional(value: string): string | undefined {
  const text = value.trim();
  return text ? text : undefined;
}

/** Тело POST /admin/certificates/issue. Дата поступления — начало локального дня (Asia/Almaty). */
export function toManualIssueBody(values: IssueFormValues, idempotencyKey: string): ManualIssueBody {
  if (!values.productId || !values.paidAt || values.quantity === null) throw new Error('form is incomplete');
  const body: ManualIssueBody = {
    productId: values.productId,
    quantity: values.quantity,
    buyer: {
      name: values.buyerName.trim(),
      company: optional(values.buyerCompany),
      phone: optional(values.buyerPhone),
      email: optional(values.buyerEmail),
    },
    deliveryChannel: values.deliveryChannel,
    locale: values.locale,
    documentNumber: values.documentNumber.trim(),
    paidAt: startOfLocalDayIso(values.paidAt),
    idempotencyKey,
  };
  if (values.total !== null && values.total !== undefined) body.total = { amount: values.total, currency: 'KZT' };
  if (!values.recipientIsBuyer) {
    body.recipient = { name: values.recipientName.trim(), phone: optional(values.recipientPhone), email: optional(values.recipientEmail) };
  }
  const message = optional(values.message);
  if (message) body.message = message;
  return body;
}
