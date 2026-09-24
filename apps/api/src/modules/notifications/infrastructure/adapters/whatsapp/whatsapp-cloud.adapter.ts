import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { safeEqual } from '../../../../../shared/infrastructure/crypto/secret-box';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../../../../shared/infrastructure/storage/file-storage';
import { ForbiddenError } from '../../../../../shared/kernel/errors';
import { Locale } from '../../../../../shared/kernel/translatable';
import {
  ChannelNotConfiguredError,
  ChannelSendRequest,
  ChannelSendResult,
  NotificationChannelAdapter,
} from '../../../application/channel-adapter';
import { ChannelStatusUpdate, ChannelStatusWebhook, WebhookRequest } from '../../../application/channel-status-webhook';
import { NOTIFICATIONS_HTTP } from '../../redaction';

/**
 * WhatsApp Business Cloud API (Meta Graph API): POST /{version}/{phone_number_id}/messages.
 * Бизнес-инициированные сообщения — только шаблоны, одобренные Meta: имя шаблона и порядок параметров
 * задаются в настройках для каждого ключа шаблона AULA. Статусы доставки (в том числе ошибка
 * «номер не в WhatsApp») приходят вебхуком — доставка тогда переходит на SMS.
 */
export const WHATSAPP_SETTINGS_KEY = 'notifications.whatsapp';
export const WHATSAPP_PROVIDER = 'whatsapp';

const LOCALES = ['kk', 'ru', 'en'] as const;

const TemplateMappingSchema = z.union([
  z
    .string()
    .min(1)
    .transform((name) => ({ name })),
  z.object({
    /** Имя одобренного шаблона в WhatsApp Manager. */
    name: z.string().min(1),
    /** Порядок параметров тела ({{1}}, {{2}}...): имена параметров AULA; по умолчанию — порядок контракта. */
    params: z.array(z.string().min(1)).optional(),
    /** Языки, на которых шаблон одобрен; для остальных используется первый. */
    languages: z.array(z.enum(LOCALES)).min(1).optional(),
    /** Именованные параметры (parameter_format NAMED) вместо позиционных. */
    namedParams: z.boolean().optional(),
    /** У шаблона есть заголовок-документ: первое вложение уходит ссылкой в заголовке. */
    documentHeader: z.boolean().optional(),
  }),
]);

const WhatsAppSettingsSchema = z.object({
  phoneNumberId: z.string().min(1),
  accessToken: z.string().min(1),
  apiVersion: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  baseUrl: z.string().url().default('https://graph.facebook.com'),
  appSecret: z.string().optional(),
  verifyToken: z.string().optional(),
  languageCodes: z.record(z.string().min(2)).default({}),
  templates: z.record(TemplateMappingSchema).default({}),
});
export type WhatsAppSettings = z.infer<typeof WhatsAppSettingsSchema>;

export const WHATSAPP_DESCRIPTOR: IntegrationDescriptor = {
  key: WHATSAPP_SETTINGS_KEY,
  title: 'WhatsApp Business API (Cloud API)',
  category: 'notifications',
  stage: 1,
  description:
    'Уведомления гостям и на номер точки через шаблоны сообщений WhatsApp Business (Meta Graph API). ' +
    'Нужен верифицированный бизнес-аккаунт и одобренные шаблоны. Вебхук статусов: /api/v1/webhooks/whatsapp.',
  fields: [
    { name: 'phoneNumberId', label: 'Phone number ID', type: 'string', required: true },
    { name: 'accessToken', label: 'Постоянный токен доступа (System User)', type: 'string', secret: true, required: true },
    { name: 'apiVersion', label: 'Версия Graph API', type: 'string', help: 'По умолчанию v21.0' },
    {
      name: 'templates',
      label: 'Шаблоны сообщений',
      type: 'json',
      required: true,
      help:
        'Соответствие ключей шаблонов AULA одобренным шаблонам: { "order.created": { "name": "aula_order_created", ' +
        '"params": ["number", "total", "trackingUrl", "branchName"], "languages": ["ru", "kk"] }, "otp.code": "aula_otp" }. ' +
        'documentHeader: true — шаблон с документом в заголовке; параметр "documentUrl" — ссылка на вложение.',
    },
    { name: 'languageCodes', label: 'Коды языков шаблонов', type: 'json', help: 'По умолчанию { "kk": "kk", "ru": "ru", "en": "en" }' },
    { name: 'appSecret', label: 'App Secret (проверка подписи вебхука)', type: 'string', secret: true },
    { name: 'verifyToken', label: 'Verify token вебхука', type: 'string', secret: true },
  ],
};

/** Коды ошибок Graph API, при которых повтор имеет смысл (временные сбои и лимиты). */
const RETRYABLE_GRAPH_CODES = new Set([1, 2, 4, 17, 341, 80007, 130429, 131000, 131016, 131056, 133004]);
const DOCUMENT_LINK_TTL_SECONDS = 7 * 24 * 3600;

interface GraphError {
  error?: { code?: number; message?: string; error_subcode?: number; error_data?: { details?: string } };
}

/** Параметр шаблона: без переводов строк и табуляции, не больше 4 пробелов подряд, не пустой (требования Meta). */
export function whatsappParamText(value: string | undefined): string {
  const text = (value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return text.length > 0 ? text.slice(0, 1024) : '—';
}

@Injectable()
export class WhatsAppCloudAdapter extends NotificationChannelAdapter implements ChannelStatusWebhook {
  readonly channel = 'whatsapp' as const;
  readonly provider = WHATSAPP_PROVIDER;
  private readonly logger = new Logger(WhatsAppCloudAdapter.name);

  constructor(
    private readonly settings: IntegrationSettings,
    @Inject(NOTIFICATIONS_HTTP) private readonly http: ExternalHttp,
    private readonly storage: FileStorage,
  ) {
    super();
  }

  private async config(): Promise<WhatsAppSettings | null> {
    return this.settings.get(WHATSAPP_SETTINGS_KEY, WhatsAppSettingsSchema);
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await this.config()) !== null;
    } catch (err) {
      this.logger.warn({ err }, 'WhatsApp settings are invalid');
      return false;
    }
  }

  async configuredProviders(): Promise<string[]> {
    return (await this.isConfigured()) ? [WHATSAPP_PROVIDER] : [];
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    let settings: WhatsAppSettings | null;
    try {
      settings = await this.config();
    } catch {
      throw new ChannelNotConfiguredError('whatsapp', 'settings are invalid');
    }
    if (!settings) throw new ChannelNotConfiguredError('whatsapp', 'integration is disabled');
    const mapping = settings.templates[request.template];
    if (!mapping) throw new ChannelNotConfiguredError('whatsapp', `template ${request.template} is not mapped`);
    const spec = typeof mapping === 'string' ? { name: mapping } : mapping;

    const attachment = request.attachments[0];
    const documentUrl = attachment ? await this.storage.signedUrl(attachment.fileKey, DOCUMENT_LINK_TTL_SECONDS, attachment.filename) : '';
    const values: Record<string, string> = { ...request.params, documentUrl };
    const names = 'params' in spec && spec.params ? spec.params : request.paramOrder;
    const named = 'namedParams' in spec && spec.namedParams === true;
    const parameters = names.map((name) =>
      named
        ? { type: 'text', parameter_name: name, text: whatsappParamText(values[name]) }
        : { type: 'text', text: whatsappParamText(values[name]) },
    );
    const components: unknown[] = [];
    if ('documentHeader' in spec && spec.documentHeader && attachment) {
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: { link: documentUrl, filename: attachment.filename } }],
      });
    }
    if (parameters.length > 0) components.push({ type: 'body', parameters });

    const locale = this.templateLocale(request.locale, 'languages' in spec ? spec.languages : undefined);
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: request.to.replace(/\D/g, ''),
      type: 'template',
      template: {
        name: spec.name,
        language: { code: settings.languageCodes[locale] ?? locale },
        components,
      },
    };
    try {
      const res = await this.http.request<{ messages?: Array<{ id?: string }> }>({
        integration: WHATSAPP_SETTINGS_KEY,
        operation: 'messages.template',
        method: 'POST',
        url: `${settings.baseUrl.replace(/\/$/, '')}/${settings.apiVersion}/${encodeURIComponent(settings.phoneNumberId)}/messages`,
        headers: { authorization: `Bearer ${settings.accessToken}` },
        body,
        correlationId: request.deliveryId,
      });
      const externalId = res.body?.messages?.[0]?.id ?? null;
      return { provider: WHATSAPP_PROVIDER, externalId };
    } catch (err) {
      throw this.classify(err);
    }
  }

  private templateLocale(locale: Locale, languages: readonly Locale[] | undefined): Locale {
    if (!languages || languages.length === 0 || languages.includes(locale)) return locale;
    return languages[0]!;
  }

  /** Уточнение классификации по коду ошибки Graph API (многие временные ошибки приходят с HTTP 400). */
  private classify(err: unknown): unknown {
    if (!(err instanceof ExternalServiceError)) return err;
    const graph = (err.responseBody ?? {}) as GraphError;
    const code = graph.error?.code;
    if (code === undefined) return err;
    const retryable = err.retryable || RETRYABLE_GRAPH_CODES.has(code);
    const details = graph.error?.error_data?.details ?? graph.error?.message ?? '';
    return new ExternalServiceError(
      WHATSAPP_SETTINGS_KEY,
      `Graph API error ${code}${details ? `: ${details}` : ''}`,
      retryable,
      err.statusCode,
      err.responseBody,
    );
  }

  // ------------------------------------------------------------ вебхук статусов

  readonly webhookProvider = WHATSAPP_PROVIDER;

  /** Подтверждение подписки (GET): hub.mode=subscribe и совпадающий verify token -> hub.challenge. */
  async verifySubscription(query: Record<string, unknown>): Promise<string | null> {
    const settings = await this.config().catch(() => null);
    const expected = settings?.verifyToken;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    if (!expected || mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string') return null;
    return safeEqual(token, expected) ? challenge : null;
  }

  /**
   * Статусы сообщений из вебхука. Подпись X-Hub-Signature-256 (HMAC-SHA256 тела ключом App Secret)
   * обязательна: без настроенного секрета или с неверной подписью вебхук отклоняется.
   */
  async parseStatuses(request: WebhookRequest): Promise<ChannelStatusUpdate[]> {
    const settings = await this.config().catch(() => null);
    if (!settings?.appSecret) throw new ForbiddenError('webhook.not_configured', 'WhatsApp webhook secret is not configured');
    if (!verifyMetaSignature(request, settings.appSecret)) {
      throw new ForbiddenError('webhook.invalid_signature', 'Invalid webhook signature');
    }
    return parseWhatsAppStatuses(request.body);
  }
}

/** Экранирование как у Meta (json_encode): «/» -> «\/», не-ASCII -> \uXXXX. */
function metaJson(body: unknown): string {
  return JSON.stringify(body)
    .replace(/\//g, '\\/')
    .replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function verifyMetaSignature(request: WebhookRequest, appSecret: string): boolean {
  const header = request.headers['x-hub-signature-256'];
  const signature = Array.isArray(header) ? header[0] : header;
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = (payload: Buffer | string) => `sha256=${createHmac('sha256', appSecret).update(payload).digest('hex')}`;
  // Точная проверка — по исходному телу; если его нет (сырое тело не сохранено), — по каноническим сериализациям.
  const candidates: Array<Buffer | string> = request.rawBody ? [request.rawBody] : [metaJson(request.body), JSON.stringify(request.body)];
  return candidates.some((c) => safeEqual(expected(c), signature));
}

interface WhatsAppWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        statuses?: Array<{
          id?: string;
          status?: string;
          timestamp?: string;
          errors?: Array<{ code?: number; title?: string; message?: string; error_data?: { details?: string } }>;
        }>;
      };
    }>;
  }>;
}

const KNOWN_STATUSES = new Set(['sent', 'delivered', 'read', 'failed']);

export function parseWhatsAppStatuses(body: unknown): ChannelStatusUpdate[] {
  const updates: ChannelStatusUpdate[] = [];
  const payload = (body ?? {}) as WhatsAppWebhookBody;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const status of change.value?.statuses ?? []) {
        if (!status.id || !status.status || !KNOWN_STATUSES.has(status.status)) continue;
        const error = status.errors?.[0];
        const seconds = Number(status.timestamp);
        updates.push({
          provider: WHATSAPP_PROVIDER,
          externalId: status.id,
          status: status.status as ChannelStatusUpdate['status'],
          errorCode: error?.code !== undefined ? String(error.code) : null,
          error: error ? [error.title, error.error_data?.details ?? error.message].filter(Boolean).join(': ') || null : null,
          occurredAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
        });
      }
    }
  }
  return updates;
}
