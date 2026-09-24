import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { z } from 'zod';
import { ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { FileStorage } from '../../../../../shared/infrastructure/storage/file-storage';
import {
  ChannelNotConfiguredError,
  ChannelSendRequest,
  ChannelSendResult,
  NotificationChannelAdapter,
} from '../../../application/channel-adapter';
import { maskEmail } from '../../../domain/masking';
import { RedactingIntegrationLog } from '../../redaction';

/**
 * Email через SMTP (nodemailer): документы гостю (сметы, счета, сертификаты) — вложениями
 * из приватного файлового хранилища. Транспорт создаётся фабрикой (в тестах подменяется).
 */
export const SMTP_SETTINGS_KEY = 'notifications.smtp';
export const SMTP_PROVIDER = 'smtp';

const SmtpSettingsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  /** true — TLS с начала соединения (порт 465); false — STARTTLS. */
  secure: z.boolean().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  /** Отправитель: 'AULA <noreply@aula.kz>'. */
  from: z.string().min(3),
  replyTo: z.string().optional(),
});
export type SmtpSettings = z.infer<typeof SmtpSettingsSchema>;

export const SMTP_DESCRIPTOR: IntegrationDescriptor = {
  key: SMTP_SETTINGS_KEY,
  title: 'Email (SMTP)',
  category: 'notifications',
  stage: 1,
  description: 'Письма гостям: документы (сметы, счета, сертификаты) вложениями и дубли уведомлений по email.',
  fields: [
    { name: 'host', label: 'SMTP-сервер', type: 'string', required: true },
    { name: 'port', label: 'Порт', type: 'number', help: '587 (STARTTLS) или 465 (TLS)' },
    { name: 'secure', label: 'TLS с начала соединения (порт 465)', type: 'boolean' },
    { name: 'user', label: 'Пользователь', type: 'string' },
    { name: 'password', label: 'Пароль', type: 'string', secret: true },
    { name: 'from', label: 'Отправитель', type: 'string', required: true, help: 'AULA <noreply@aula.kz>' },
    { name: 'replyTo', label: 'Адрес для ответа', type: 'string' },
  ],
};

export interface SmtpMail {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  headers?: Record<string, string>;
}

export interface SmtpSendInfo {
  messageId?: string;
  accepted?: unknown[];
  rejected?: unknown[];
  response?: string;
}

export interface SmtpTransport {
  sendMail(mail: SmtpMail): Promise<SmtpSendInfo>;
  close?(): void;
}

/** Фабрика SMTP-транспорта (nodemailer). В тестах подменяется фейком. */
@Injectable()
export class SmtpTransportFactory {
  create(settings: SmtpSettings): SmtpTransport {
    const transport = createTransport({
      host: settings.host,
      port: settings.port ?? 587,
      secure: settings.secure ?? settings.port === 465,
      auth: settings.user ? { user: settings.user, pass: settings.password ?? '' } : undefined,
      pool: true,
      maxConnections: 2,
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
    return {
      sendMail: (mail) => transport.sendMail(mail) as Promise<SmtpSendInfo>,
      close: () => transport.close(),
    };
  }
}

const RETRYABLE_SMTP_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'ECONNREFUSED', 'EPROTOCOL']);

/** Классификация ошибок SMTP: 4xx и сетевые — временные, 5xx, авторизация и адрес — постоянные. */
export function classifySmtpError(err: unknown): ExternalServiceError {
  const e = (err ?? {}) as { code?: string; responseCode?: number; message?: string; response?: string };
  const message = e.message ?? String(err);
  let retryable: boolean;
  if (typeof e.responseCode === 'number') retryable = e.responseCode >= 400 && e.responseCode < 500;
  else if (e.code === 'EAUTH' || e.code === 'EENVELOPE' || e.code === 'EMESSAGE') retryable = false;
  else retryable = RETRYABLE_SMTP_CODES.has(e.code ?? '') || !e.code;
  return new ExternalServiceError(SMTP_SETTINGS_KEY, `sendMail failed: ${message}`, retryable, e.responseCode ?? null, e.response ?? null);
}

@Injectable()
export class SmtpEmailAdapter extends NotificationChannelAdapter implements OnModuleDestroy {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(SmtpEmailAdapter.name);
  private cached: { key: string; transport: SmtpTransport } | null = null;

  constructor(
    private readonly settings: IntegrationSettings,
    private readonly factory: SmtpTransportFactory,
    private readonly storage: FileStorage,
    private readonly log: RedactingIntegrationLog,
  ) {
    super();
  }

  private async config(): Promise<SmtpSettings | null> {
    return this.settings.get(SMTP_SETTINGS_KEY, SmtpSettingsSchema);
  }

  async isConfigured(): Promise<boolean> {
    try {
      return (await this.config()) !== null;
    } catch (err) {
      this.logger.warn({ err }, 'SMTP settings are invalid');
      return false;
    }
  }

  async configuredProviders(): Promise<string[]> {
    return (await this.isConfigured()) ? [SMTP_PROVIDER] : [];
  }

  private transportFor(settings: SmtpSettings): SmtpTransport {
    const key = JSON.stringify(settings);
    if (this.cached?.key === key) return this.cached.transport;
    this.cached?.transport.close?.();
    const transport = this.factory.create(settings);
    this.cached = { key, transport };
    return transport;
  }

  async send(request: ChannelSendRequest): Promise<ChannelSendResult> {
    let settings: SmtpSettings | null;
    try {
      settings = await this.config();
    } catch {
      throw new ChannelNotConfiguredError('email', 'settings are invalid');
    }
    if (!settings) throw new ChannelNotConfiguredError('email', 'integration is disabled');

    const attachments = [];
    for (const a of request.attachments) {
      attachments.push({ filename: a.filename, contentType: a.contentType, content: await this.storage.get(a.fileKey, 'private') });
    }
    const mail: SmtpMail = {
      from: settings.from,
      to: request.to,
      replyTo: settings.replyTo,
      subject: request.content.subject ?? 'AULA',
      text: request.content.text,
      html: request.content.html ?? undefined,
      attachments,
      headers: { 'X-AULA-Delivery': request.deliveryId },
    };
    const started = Date.now();
    const logRequest = {
      to: maskEmail(request.to),
      subject: mail.subject,
      text: mail.text,
      attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.content.length })),
    };
    try {
      const info = await this.transportFor(settings).sendMail(mail);
      await this.log.record({
        integration: SMTP_SETTINGS_KEY,
        direction: 'outbound',
        operation: 'sendMail',
        correlationId: request.deliveryId,
        request: logRequest,
        response: { messageId: info.messageId ?? null, response: info.response ?? null, rejected: info.rejected?.length ?? 0 },
        statusCode: null,
        success: true,
        durationMs: Date.now() - started,
      });
      if (info.rejected && info.rejected.length > 0 && (!info.accepted || info.accepted.length === 0)) {
        throw new ExternalServiceError(SMTP_SETTINGS_KEY, 'recipient rejected by SMTP server', false, null, info.response ?? null);
      }
      return { provider: SMTP_PROVIDER, externalId: info.messageId ?? null };
    } catch (err) {
      if (err instanceof ExternalServiceError) throw err;
      const classified = classifySmtpError(err);
      await this.log.record({
        integration: SMTP_SETTINGS_KEY,
        direction: 'outbound',
        operation: 'sendMail',
        correlationId: request.deliveryId,
        request: logRequest,
        response: null,
        statusCode: classified.statusCode,
        success: false,
        durationMs: Date.now() - started,
        error: classified.message,
      });
      throw classified;
    }
  }

  onModuleDestroy(): void {
    this.cached?.transport.close?.();
    this.cached = null;
  }
}
