import { Money } from '../../../shared/kernel/money';
import { PaymentPurpose } from '../public';

/**
 * Интерфейс платёжного провайдера (правило 4 ТЗ: интеграции только за интерфейсом).
 * Реализации — в infrastructure/adapters/<провайдер>. Модули заказа, брони и банкетов о провайдерах
 * не знают: смена провайдера — это настройка (payments.routing), а не код.
 *
 * Все методы, кроме verifyWebhook и checkoutPage, ходят во внешнюю систему и вызываются
 * только из фоновых задач (@JobHandler) — с повторами и классификацией ошибок ExternalServiceError.
 */
export interface GatewayPayment {
  paymentId: string;
  /** Числовой номер счёта (invoiceID для провайдера). */
  invoiceNo: number;
  externalId: string | null;
  purpose: PaymentPurpose;
  branchId: string | null;
  amount: Money;
  description: string;
  customer: { phone: string | null; name: string | null; email: string | null };
  returnUrl: string | null;
  providerData: Record<string, unknown>;
}

export interface GatewayInitiation {
  externalId: string;
  /** Куда перенаправить гостя. */
  paymentUrl: string;
  /** До какого момента действует страница оплаты (если провайдер ограничивает). */
  expiresAt: Date | null;
  /** Служебные данные провайдера (id транзакции, зашифрованный токен страницы оплаты). */
  providerData?: Record<string, unknown>;
}

export type GatewayPaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface GatewayStatus {
  status: GatewayPaymentStatus;
  /** Сумма, которую провайдер подтвердил (null — не сообщил). */
  amount: Money | null;
  reason?: string | null;
  providerData?: Record<string, unknown>;
}

export interface GatewayRefundResult {
  externalRefundId: string | null;
}

/** Входящий вебхук как есть: заголовки, тело (сырое и разобранное), query. */
export interface WebhookRequest {
  headers: Record<string, string>;
  /** Сырое тело, если платформа его сохранила; иначе — каноническая сериализация разобранного тела. */
  rawBody: string;
  rawBodyIsExact: boolean;
  body: unknown;
  query: Record<string, string>;
}

/** Нормализованное уведомление провайдера. */
export interface GatewayNotification {
  /** Идентификатор события у провайдера — ключ идемпотентности вебхука. */
  eventId: string;
  externalId: string;
  status: GatewayPaymentStatus;
  amount: Money | null;
  reason?: string | null;
  providerData?: Record<string, unknown>;
}

export abstract class PaymentGateway {
  /** Имя провайдера (ключ настроек payments.<provider>). */
  abstract readonly provider: string;
  /** Провайдер по умолчанию для dev/staging, если маршрутизация не настроена. */
  readonly devFallback: boolean = false;

  /** Доступен ли провайдер для новых платежей (включён и настроен). */
  abstract isEnabled(): Promise<boolean>;
  /** Создать платёж у провайдера: внешний id + ссылка на страницу оплаты. */
  abstract initiate(payment: GatewayPayment): Promise<GatewayInitiation>;
  /** Статус платежа у провайдера (опрос — на случай пропущенного вебхука). */
  abstract fetchStatus(payment: GatewayPayment): Promise<GatewayStatus>;
  /** Возврат суммы. refundId — наш id возврата (идемпотентность, где провайдер поддерживает). */
  abstract refund(payment: GatewayPayment, amount: Money, refundId: string): Promise<GatewayRefundResult>;
  /** Проверить подпись и разобрать вебхук. Неверная подпись — ForbiddenError. */
  abstract verifyWebhook(request: WebhookRequest): Promise<GatewayNotification>;

  /**
   * HTML-страница оплаты на нашем домене — для провайдеров с виджетом на стороне мерчанта.
   * null — провайдер сам отдаёт страницу по paymentUrl.
   */
  async checkoutPage(_payment: GatewayPayment): Promise<string | null> {
    return null;
  }

  /** Тело ответа провайдеру на вебхук (HTTP 200). */
  webhookAck(): Record<string, unknown> {
    return { received: true };
  }
}
