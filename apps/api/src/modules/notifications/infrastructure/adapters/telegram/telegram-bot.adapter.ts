import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../../../../shared/infrastructure/storage/file-storage';
import {
  ChannelNotConfiguredError,
  ChannelSendRequest,
  ChannelSendResult,
  NotificationChannelAdapter,
} from '../../../application/channel-adapter';
import { NOTIFICATIONS_HTTP } from '../../redaction';

/**
 * Telegram Bot API (этап 2): дублирование уведомлений персоналу — в личные чаты сотрудников
 * и в чат филиала. sendMessage для текста, sendDocument (ссылкой) для вложений.
 */
export const TELEGRAM_SETTINGS_KEY = 'notifications.telegram';
export const TELEGRAM_PROVIDER = 'telegram';
const DEFAULT_BASE_URL = 'https://api.telegram.org';

const TelegramSettingsSchema = z.object({
  botToken: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/, 'Bot token looks like 123456:ABC-DEF...'),
  baseUrl: z.string().url().optional(),
});
type TelegramSettings = z.infer<typeof TelegramSettingsSchema>;

export const TELEGRAM_DESCRIPTOR: IntegrationDescriptor = {
  key: TELEGRAM_SETTINGS_KEY,
  title: 'Telegram-бот (уведомления персоналу)',
  category: 'notifications',
  stage: 2,
  description:
    'Дублирование уведомлений персоналу в Telegram: личные чаты сотрудников (Telegram chat id в профиле) ' +
    'и чат филиала (настройка филиала). Бот создаётся через @BotFather и добавляется в чат.',
  fields: [
    { name: 'botToken', label: 'Токен бота', type: 'string', secret: true, required: true },
    { name: 'baseUrl', label: 'Адрес Bot API', type: 'url', help: 'По умолчанию https://api.telegram.org' },
  ],
};

const TEXT_LIMIT = 4096;
const CAPTION_LIMIT = 1024;
const DOCUMENT_LINK_TTL_SECONDS = 24 * 3600;

interface TelegramResponse {
  ok?: boolean;
  description?: string;
  error_code?: number;
  result?: { message_id?: number };
}

@Injectable()
export class TelegramBotAdapter extends NotificationChannelAdapter {
  readonly channel = 'telegram' as const;
  private readonly logger = new Logger(TelegramBotAdapter.name);

  constructor(
    private readonly settings: IntegrationSettings,
    @Inject(NOTIFICATIONS_HTTP) private readonly http: ExternalHttp,
    private readonly storage: FileStorage,
  ) {
    super();
  }

  private async config(): Promise<TelegramSettings | null> {
    return this.settings.get(TELEGRAM_SETTINGS_KEY, TelegramSettingsSchema);
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await this.config()) !== null;
    } catch (err) {
      this.logger.warn({ err }, 'Telegram settings are invalid');
      return false;
    }
  }

  async configuredProviders(): Promise<string[]> {
    return (await this.isConfigured()) ? [TELEGRAM_PROVIDER] : [];
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    let settings: TelegramSettings | null;
    try {
      settings = await this.config();
    } catch {
      throw new ChannelNotConfiguredError('telegram', 'settings are invalid');
    }
    if (!settings) throw new ChannelNotConfiguredError('telegram', 'integration is disabled');
    const base = `${(settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/bot${settings.botToken}`;

    const message = await this.call(base, 'sendMessage', request.deliveryId, {
      chat_id: request.to,
      text: request.content.text.slice(0, TEXT_LIMIT),
      disable_web_page_preview: true,
    });
    for (const attachment of request.attachments) {
      const link = await this.storage.signedUrl(attachment.fileKey, DOCUMENT_LINK_TTL_SECONDS, attachment.filename);
      await this.call(base, 'sendDocument', request.deliveryId, {
        chat_id: request.to,
        document: link,
        caption: attachment.filename.slice(0, CAPTION_LIMIT),
      });
    }
    const id = message.result?.message_id;
    return { provider: TELEGRAM_PROVIDER, externalId: id !== undefined ? `${request.to}:${id}` : null };
  }

  private async call(base: string, method: string, correlationId: string, body: Record<string, unknown>): Promise<TelegramResponse> {
    const res = await this.http.request<TelegramResponse>({
      integration: TELEGRAM_SETTINGS_KEY,
      operation: method,
      method: 'POST',
      url: `${base}/${method}`,
      body,
      correlationId,
    });
    if (res.body?.ok === false) {
      throw new ExternalServiceError(TELEGRAM_SETTINGS_KEY, `${method}: ${res.body.description ?? 'error'}`, false, res.status, res.body);
    }
    return res.body ?? {};
  }
}
