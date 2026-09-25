/**
 * Публичный контракт модуля Customers: база гостей. Гость идентифицируется по номеру телефона
 * (уникален, нормализован в +7XXXXXXXXXX). Согласие на обработку ПД фиксируется явно,
 * с датой и версией текста (закон РК о персональных данных).
 */
import { Locale } from '../../../shared/kernel/translatable';

export const CustomerTag = {
  Corporate: 'corporate',
  Regular: 'regular',
  Banquet: 'banquet',
  Vip: 'vip',
} as const;
export type CustomerTag = (typeof CustomerTag)[keyof typeof CustomerTag] | string;

export interface CustomerProfile {
  id: string;
  phone: string;
  name: string | null;
  email: string | null;
  locale: Locale;
  tags: string[];
  allergies: string | null;
  preferences: string | null;
  personalDataConsent: boolean;
  marketingConsent: boolean;
}

export type ConsentKind = 'personal_data' | 'marketing';

export abstract class CustomerDirectory {
  /**
   * Найти или создать гостя по телефону. Имя/почта обновляются, если были пустыми
   * (не затираем то, что ввёл менеджер).
   */
  abstract identify(input: {
    phone: string;
    name?: string | null;
    email?: string | null;
    locale?: Locale;
  }): Promise<{ customerId: string; isNew: boolean }>;
  abstract get(customerId: string): Promise<CustomerProfile>;
  abstract findByPhone(phone: string): Promise<CustomerProfile | null>;
  /** Явное согласие/отзыв. textVersion — версия текста, с которым гость согласился. */
  abstract recordConsent(input: {
    customerId: string;
    kind: ConsentKind;
    granted: boolean;
    textVersion: string;
    source: 'web' | 'admin' | 'phone';
    ip?: string | null;
  }): Promise<void>;
  /** Действующая версия текста согласия на обработку ПД (показывается на формах). */
  abstract currentConsentVersion(kind: ConsentKind): Promise<string>;
  /** Добавить тег (например 'banquet' после заявки, 'corporate' при оплате юрлицом). */
  abstract addTag(customerId: string, tag: CustomerTag): Promise<void>;
}

/**
 * Подтверждение телефона SMS-кодом (для заказов с оплатой при получении и броней без депозита,
 * если включено в настройках филиала).
 */
export abstract class PhoneVerification {
  /** Отправить код. TooManyRequestsError при частых запросах. */
  abstract start(phone: string, locale: Locale): Promise<{ verificationId: string; expiresAt: Date; resendAfterSeconds: number }>;
  /** Проверить код -> токен подтверждения (действует 30 минут). */
  abstract verify(verificationId: string, code: string): Promise<{ token: string; phone: string }>;
  /** ValidationError 'phone.not_verified', если токен не подтверждает этот телефон. */
  abstract assertVerified(phone: string, token: string | null | undefined): Promise<void>;
}

export const CustomersEvents = {
  CustomerCreated: 'customers.customer_created',
  /**
   * Гость обезличен по требованию (закон РК о ПД): телефон, имя, почта стёрты, агрегаты сохранены.
   * Модули, хранящие копии контактов гостя, стирают их у себя: по customerId (заказы, брони, заявки)
   * или по телефону/почте из payload (платежи, сертификаты, журнал уведомлений). Payload содержит
   * прежние телефон и почту — событие хранится в outbox не дольше 30 дней (очистка платформы).
   */
  CustomerAnonymized: 'customers.customer_anonymized',
} as const;

export interface CustomerCreatedPayload {
  customerId: string;
  phone: string;
  occurredAt: string;
}

export interface CustomerAnonymizedPayload {
  customerId: string;
  /**
   * Прежний телефон гостя (+7XXXXXXXXXX) — чтобы модули без customerId (платежи, сертификаты,
   * уведомления) нашли и стёрли свои копии. Нет в событиях, опубликованных до добавления поля.
   */
  phone?: string | null;
  /** Прежняя почта гостя (если была). */
  email?: string | null;
  occurredAt: string;
}
