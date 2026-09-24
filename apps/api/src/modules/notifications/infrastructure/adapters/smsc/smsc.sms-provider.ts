import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { NOTIFICATIONS_HTTP } from '../../redaction';
import { SmsProvider } from '../sms/sms-channel';

/**
 * SMS-шлюз SMSC.kz (smsc.kz/sys/send.php, fmt=3 — ответ JSON). Успех: { id, cnt };
 * ошибка: { error, error_code }. Логин и пароль — в теле формы (в журнале маскируются).
 */
export const SMSC_SETTINGS_KEY = 'notifications.smsc';
export const SMSC_CODE = 'smsc';
const DEFAULT_BASE_URL = 'https://smsc.kz';

const SmscSettingsSchema = z.object({
  login: z.string().min(1),
  password: z.string().min(1),
  sender: z.string().max(11).optional(),
  baseUrl: z.string().url().optional(),
});
type SmscSettings = z.infer<typeof SmscSettingsSchema>;

export const SMSC_DESCRIPTOR: IntegrationDescriptor = {
  key: SMSC_SETTINGS_KEY,
  title: 'SMS: SMSC.kz',
  category: 'notifications',
  stage: 1,
  description: 'SMS-шлюз SMSC.kz: резервный или основной шлюз для кодов подтверждения и уведомлений гостям.',
  fields: [
    { name: 'login', label: 'Логин', type: 'string', required: true },
    { name: 'password', label: 'Пароль (или API-пароль)', type: 'string', secret: true, required: true },
    { name: 'sender', label: 'Имя отправителя', type: 'string' },
    { name: 'baseUrl', label: 'Адрес API', type: 'url', help: 'По умолчанию https://smsc.kz' },
  ],
};

/** Коды ошибок SMSC, при которых повтор имеет смысл: 4 — IP временно заблокирован, 9 — слишком много одинаковых запросов. */
const RETRYABLE_ERROR_CODES = new Set([4, 9]);

interface SmscResponse {
  id?: number | string;
  cnt?: number;
  error?: string;
  error_code?: number;
}

@Injectable()
export class SmscSmsProvider extends SmsProvider {
  readonly code = SMSC_CODE;
  private readonly logger = new Logger(SmscSmsProvider.name);

  constructor(
    private readonly settings: IntegrationSettings,
    @Inject(NOTIFICATIONS_HTTP) private readonly http: ExternalHttp,
  ) {
    super();
  }

  private async config(): Promise<SmscSettings | null> {
    return this.settings.get(SMSC_SETTINGS_KEY, SmscSettingsSchema);
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await this.config()) !== null;
    } catch (err) {
      this.logger.warn({ err }, 'SMSC settings are invalid');
      return false;
    }
  }

  async send(input: { to: string; text: string; correlationId: string }): Promise<{ externalId: string | null }> {
    const settings = await this.config();
    if (!settings) throw new ExternalServiceError(SMSC_SETTINGS_KEY, 'integration is disabled', false);
    const form = new URLSearchParams({
      login: settings.login,
      psw: settings.password,
      phones: input.to.replace(/\D/g, ''),
      mes: input.text,
      fmt: '3',
      charset: 'utf-8',
    });
    if (settings.sender) form.set('sender', settings.sender);
    const res = await this.http.request<unknown>({
      integration: SMSC_SETTINGS_KEY,
      operation: 'send',
      method: 'POST',
      url: `${(settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/sys/send.php`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      correlationId: input.correlationId,
    });
    let body: SmscResponse = {};
    if (typeof res.body === 'string') {
      try {
        body = JSON.parse(res.body) as SmscResponse;
      } catch {
        body = {};
      }
    } else {
      body = (res.body ?? {}) as SmscResponse;
    }
    if (body.error !== undefined || body.error_code !== undefined || body.id === undefined) {
      const code = Number(body.error_code);
      throw new ExternalServiceError(
        SMSC_SETTINGS_KEY,
        `send error ${Number.isFinite(code) ? code : '?'}: ${body.error ?? 'unexpected response'}`,
        RETRYABLE_ERROR_CODES.has(code),
        res.status,
        body,
      );
    }
    return { externalId: String(body.id) };
  }
}
