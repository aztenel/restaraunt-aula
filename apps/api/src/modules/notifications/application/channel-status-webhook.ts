/**
 * Статусы доставки от провайдера канала (вебхук): отправлено, доставлено, прочитано, ошибка.
 * Разбор формата и проверка подписи — в адаптере провайдера; применение к доставкам — в действии модуля.
 */
export interface ChannelStatusUpdate {
  provider: string;
  externalId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  errorCode: string | null;
  error: string | null;
  occurredAt: Date | null;
}

export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  /** Исходное тело запроса, если сохранено (точная проверка подписи). */
  rawBody?: Buffer;
  body: unknown;
}

export abstract class ChannelStatusWebhook {
  abstract readonly webhookProvider: string;
  /** Подтверждение подписки на вебхук: ответ-«challenge» или null (отказ). */
  abstract verifySubscription(query: Record<string, unknown>): Promise<string | null>;
  /** Проверить подпись и разобрать статусы. ForbiddenError — подпись неверна или вебхук не настроен. */
  abstract parseStatuses(request: WebhookRequest): Promise<ChannelStatusUpdate[]>;
}

/** Вебхук статусов WhatsApp (реализация — адаптер WhatsApp Business). */
export const WHATSAPP_STATUS_WEBHOOK = Symbol('WHATSAPP_STATUS_WEBHOOK');
