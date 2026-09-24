import { Locale } from '../../../shared/kernel/translatable';
import { NotificationAttachment, NotificationChannel } from '../public';

/**
 * Канал уведомлений (NotificationChannel из ТЗ, правило 4): интерфейс в модуле, реализации —
 * в infrastructure/adapters/<провайдер>. Смена провайдера (другой SMS-шлюз, другой почтовый сервер)
 * не затрагивает код доставки и модулей-отправителей.
 *
 * Адаптер вызывается только из фоновой задачи доставки. Ошибки:
 * - ExternalServiceError(retryable=true) — временный сбой, задача повторит попытку с задержкой;
 * - ExternalServiceError(retryable=false) — постоянная ошибка, доставка перейдёт к резервному каналу;
 * - ChannelNotConfiguredError — канал (или шаблон в канале) не настроен.
 */
export interface RenderedContent {
  subject: string | null;
  text: string;
  html: string | null;
}

export interface ChannelSendRequest {
  /** Идентификатор доставки: корреляция в журнале интеграций. */
  deliveryId: string;
  channel: NotificationChannel;
  /** Телефон +7XXXXXXXXXX, email или id чата Telegram. */
  to: string;
  locale: Locale;
  template: string;
  /** Параметры шаблона (настоящие значения) и их порядок в контракте. */
  params: Record<string, string>;
  paramOrder: readonly string[];
  content: RenderedContent;
  attachments: readonly NotificationAttachment[];
}

export interface ChannelSendResult {
  /** Код провайдера (адаптера), фактически отправившего сообщение. */
  provider: string;
  /** Идентификатор сообщения у провайдера (для статусов доставки). */
  externalId: string | null;
}

export abstract class NotificationChannelAdapter {
  abstract readonly channel: NotificationChannel;
  /** Есть включённые и корректные настройки хотя бы одного провайдера канала. */
  abstract isConfigured(): Promise<boolean>;
  /** Коды настроенных провайдеров (для админки). */
  abstract configuredProviders(): Promise<string[]>;
  abstract send(request: ChannelSendRequest): Promise<ChannelSendResult>;
}

/** Канал или шаблон в канале не настроен: доставка переходит к следующему каналу. */
export class ChannelNotConfiguredError extends Error {
  constructor(
    readonly channel: NotificationChannel,
    readonly reason: string,
  ) {
    super(`Channel ${channel} is not configured: ${reason}`);
    this.name = 'ChannelNotConfiguredError';
  }
}

/** Все адаптеры каналов модуля (мульти-провайдер в notifications.module.ts). */
export const CHANNEL_ADAPTERS = Symbol('NOTIFICATION_CHANNEL_ADAPTERS');

/**
 * Служебный канал «в журнал» вне продакшена: если ни один канал цепочки не настроен (dev, тесты, staging
 * без ключей), сообщение пишется в лог приложения и считается отправленным (provider = 'log').
 */
export abstract class FallbackLogChannel {
  abstract readonly provider: string;
  abstract send(request: ChannelSendRequest): Promise<ChannelSendResult>;
}
