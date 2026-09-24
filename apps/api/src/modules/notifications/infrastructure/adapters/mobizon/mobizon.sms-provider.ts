import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { NOTIFICATIONS_HTTP } from '../../redaction';
import { SmsProvider } from '../sms/sms-channel';

/**
 * SMS-шлюз Mobizon (api.mobizon.kz): метод message/sendSmsMessage, ответ { code, data, message },
 * code = 0 — сообщение принято. Ключ API передаётся в строке запроса (в журнале маскируется).
 */
export const MOBIZON_SETTINGS_KEY = 'notifications.mobizon';
export const MOBIZON_CODE = 'mobizon';

const MobizonSettingsSchema = z.object({
  apiKey: z.string().min(10),
  baseUrl: z.string().url().default('https://api.mobizon.kz'),
  /** Альфа-имя отправителя (зарегистрированное в Mobizon); пусто — имя по умолчанию. */
  from: z.string().max(11).optional(),
});
type MobizonSettings = z.infer<typeof MobizonSettingsSchema>;

export const MOBIZON_DESCRIPTOR: IntegrationDescriptor = {
  key: MOBIZON_SETTINGS_KEY,
  title: 'SMS: Mobizon',
  category: 'notifications',
  stage: 1,
  description: 'SMS-шлюз Mobizon (Казахстан): коды подтверждения и резерв для уведомлений, если WhatsApp недоступен.',
  fields: [
    { name: 'apiKey', label: 'Ключ API', type: 'string', secret: true, required: true },
    { name: 'from', label: 'Имя отправителя (альфа-имя)', type: 'string' },
    { name: 'baseUrl', label: 'Адрес API', type: 'url', help: 'По умолчанию https://api.mobizon.kz' },
  ],
};

interface MobizonResponse {
  code?: number | string;
  message?: string;
  data?: { messageId?: string | number; campaignId?: string | number; status?: number };
}

function parseBody(body: unknown): MobizonResponse {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as MobizonResponse;
    } catch {
      return {};
    }
  }
  return (body ?? {}) as MobizonResponse;
}

@Injectable()
export class MobizonSmsProvider extends SmsProvider {
  readonly code = MOBIZON_CODE;
  private readonly logger = new Logger(MobizonSmsProvider.name);

  constructor(
    private readonly settings: IntegrationSettings,
    @Inject(NOTIFICATIONS_HTTP) private readonly http: ExternalHttp,
  ) {
    super();
  }

  private async config(): Promise<MobizonSettings | null> {
    return this.settings.get(MOBIZON_SETTINGS_KEY, MobizonSettingsSchema);
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await this.config()) !== null;
    } catch (err) {
      this.logger.warn({ err }, 'Mobizon settings are invalid');
      return false;
    }
  }

  async send(input: { to: string; text: string; correlationId: string }): Promise<{ externalId: string | null }> {
    const settings = await this.config();
    if (!settings) throw new ExternalServiceError(MOBIZON_SETTINGS_KEY, 'integration is disabled', false);
    const form = new URLSearchParams({ recipient: input.to.replace(/\D/g, ''), text: input.text });
    if (settings.from) form.set('from', settings.from);
    const query = new URLSearchParams({ output: 'json', api: 'v1', apiKey: settings.apiKey });
    const res = await this.http.request<unknown>({
      integration: MOBIZON_SETTINGS_KEY,
      operation: 'message.sendSmsMessage',
      method: 'POST',
      url: `${settings.baseUrl.replace(/\/$/, '')}/service/message/sendsmsmessage?${query.toString()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      correlationId: input.correlationId,
    });
    const body = parseBody(res.body);
    const code = Number(body.code);
    if (code !== 0) {
      // Коды Mobizon: 0 — успех; остальные — ошибки данных, авторизации, баланса: повтор не поможет.
      throw new ExternalServiceError(MOBIZON_SETTINGS_KEY, `sendSmsMessage code ${String(body.code)}: ${body.message ?? ''}`, false, res.status, body);
    }
    const id = body.data?.messageId;
    return { externalId: id !== undefined && id !== null ? String(id) : null };
  }
}
