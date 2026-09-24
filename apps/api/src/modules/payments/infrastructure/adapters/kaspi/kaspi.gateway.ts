import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { hmacSha256, safeEqual } from '../../../../../shared/infrastructure/crypto/secret-box';
import { ExternalHttp, ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { Clock } from '../../../../../shared/kernel/clock';
import { ForbiddenError, ValidationError } from '../../../../../shared/kernel/errors';
import { Money } from '../../../../../shared/kernel/money';
import { PaymentLinks } from '../../../application/payment-links';
import { parseMajorAmount, toMajorString } from '../../../domain/money-format';
import {
  GatewayInitiation,
  GatewayNotification,
  GatewayPayment,
  GatewayPaymentStatus,
  GatewayRefundResult,
  GatewayStatus,
  PaymentGateway,
  WebhookRequest,
} from '../../../domain/payment-gateway';

/*
 * Kaspi Pay (мерчант-API Kaspi.kz). ВНИМАНИЕ: API не публичное — условия подключения, адреса методов,
 * формат запросов/ответов и способ подписи уведомлений УТОЧНЯЮТСЯ У БАНКА (риск из раздела «Интеграции» ТЗ).
 * Поэтому адаптер конфигурируемый: базовый адрес, пути всех методов, заголовок авторизации и подписи,
 * единица суммы и соответствие статусов задаются в настройках payments.kaspi без изменения кода.
 * Реализованный контракт (по типовой схеме мерчант-API): создание платежа/QR-ссылки по номеру заказа
 * и сумме, опрос статуса, возврат, вебхук с подписью HMAC-SHA256 общим секретом.
 */

export const KASPI_PROVIDER = 'kaspi';
export const KASPI_SETTINGS_KEY = 'payments.kaspi';

const StatusValue = z.enum(['pending', 'succeeded', 'failed', 'cancelled']);

export const KaspiSettingsSchema = z.object({
  baseUrl: z.string().url(),
  merchantId: z.string().min(1),
  apiKey: z.string().min(1),
  webhookSecret: z.string().min(16),
  createPath: z.string().startsWith('/').default('/payments'),
  statusPath: z.string().startsWith('/').default('/payments/{externalId}'),
  refundPath: z.string().startsWith('/').default('/payments/{externalId}/refunds'),
  authHeader: z.string().min(1).default('Authorization'),
  authScheme: z.string().default('Bearer'),
  signatureHeader: z.string().min(1).default('x-signature'),
  amountUnit: z.enum(['tenge', 'tiyn']).default('tenge'),
  paymentTtlMinutes: z.coerce.number().int().min(5).max(1440).default(20),
  statusMap: z.record(StatusValue).default({}),
});
export type KaspiSettings = z.infer<typeof KaspiSettingsSchema>;

export const KASPI_DESCRIPTOR: IntegrationDescriptor = {
  key: KASPI_SETTINGS_KEY,
  title: 'Kaspi Pay',
  category: 'payments',
  stage: 1,
  description:
    'Оплата через Kaspi.kz (платёжная ссылка / QR). API мерчанта не публичное: адреса методов, формат и подпись ' +
    'уведомлений уточняются у банка — все пути и параметры задаются здесь. Уведомления подписываются HMAC-SHA256 общим секретом.',
  fields: [
    { name: 'baseUrl', label: 'Базовый URL API (уточняется у банка)', type: 'url', required: true },
    { name: 'merchantId', label: 'ID мерчанта', type: 'string', required: true },
    { name: 'apiKey', label: 'API-ключ', type: 'string', secret: true, required: true },
    { name: 'webhookSecret', label: 'Секрет подписи уведомлений (HMAC)', type: 'string', secret: true, required: true },
    { name: 'createPath', label: 'Путь: создание платежа', type: 'string', help: 'По умолчанию /payments' },
    { name: 'statusPath', label: 'Путь: статус платежа', type: 'string', help: 'По умолчанию /payments/{externalId}' },
    { name: 'refundPath', label: 'Путь: возврат', type: 'string', help: 'По умолчанию /payments/{externalId}/refunds' },
    { name: 'authHeader', label: 'Заголовок авторизации', type: 'string', help: 'По умолчанию Authorization' },
    { name: 'authScheme', label: 'Схема авторизации', type: 'string', help: 'Bearer / пусто' },
    { name: 'signatureHeader', label: 'Заголовок подписи уведомлений', type: 'string', help: 'По умолчанию x-signature' },
    { name: 'amountUnit', label: 'Единица суммы в API', type: 'select', options: ['tenge', 'tiyn'] },
    { name: 'paymentTtlMinutes', label: 'Срок жизни ссылки на оплату, минут', type: 'number' },
    { name: 'statusMap', label: 'Соответствие статусов провайдера', type: 'json', help: '{ "PAID": "succeeded", ... }' },
  ],
};

const DEFAULT_STATUS_MAP: Record<string, GatewayPaymentStatus> = {
  paid: 'succeeded',
  success: 'succeeded',
  succeeded: 'succeeded',
  completed: 'succeeded',
  approved: 'succeeded',
  processed: 'succeeded',
  failed: 'failed',
  declined: 'failed',
  rejected: 'failed',
  error: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  expired: 'cancelled',
};

export function mapKaspiStatus(value: unknown, overrides: Record<string, GatewayPaymentStatus> = {}): GatewayPaymentStatus {
  const raw = String(value ?? '').trim();
  return overrides[raw] ?? overrides[raw.toLowerCase()] ?? DEFAULT_STATUS_MAP[raw.toLowerCase()] ?? 'pending';
}

/** Подпись уведомления: HMAC-SHA256(secret, тело) в hex или base64, допускается префикс «sha256=». */
export function verifyKaspiSignature(secret: string, rawBody: string, header: string | undefined): boolean {
  if (!header) return false;
  const provided = header.trim().replace(/^sha256=/i, '');
  return safeEqual(hmacSha256(secret, rawBody, 'hex'), provided.toLowerCase()) || safeEqual(hmacSha256(secret, rawBody, 'base64'), provided);
}

function pick(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

@Injectable()
export class KaspiGateway extends PaymentGateway {
  readonly provider = KASPI_PROVIDER;

  constructor(
    private readonly settings: IntegrationSettings,
    private readonly http: ExternalHttp,
    private readonly links: PaymentLinks,
    private readonly clock: Clock,
  ) {
    super();
  }

  private async load(): Promise<KaspiSettings> {
    const raw = await this.settings.getRaw(KASPI_SETTINGS_KEY);
    const parsed = KaspiSettingsSchema.safeParse({ ...(raw?.config ?? {}), ...(raw?.secrets ?? {}) });
    if (!raw || !parsed.success) {
      throw new ValidationError('integration.misconfigured', `Integration ${KASPI_SETTINGS_KEY} is not configured`);
    }
    return parsed.data;
  }

  async isEnabled(): Promise<boolean> {
    const raw = await this.settings.getRaw(KASPI_SETTINGS_KEY);
    return !!raw?.enabled && KaspiSettingsSchema.safeParse({ ...raw.config, ...raw.secrets }).success;
  }

  private url(s: KaspiSettings, path: string, payment: GatewayPayment): string {
    const filled = path
      .replace('{externalId}', encodeURIComponent(payment.externalId ?? ''))
      .replace('{orderId}', encodeURIComponent(String(payment.invoiceNo)))
      .replace('{merchantId}', encodeURIComponent(s.merchantId));
    return `${s.baseUrl.replace(/\/$/, '')}${filled}`;
  }

  private headers(s: KaspiSettings): Record<string, string> {
    return { [s.authHeader.toLowerCase()]: s.authScheme ? `${s.authScheme} ${s.apiKey}` : s.apiKey };
  }

  private amountOut(s: KaspiSettings, money: Money): number | string {
    return s.amountUnit === 'tiyn' ? money.amount : toMajorString(money);
  }

  private amountIn(s: KaspiSettings, value: unknown): Money | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'object') return this.amountIn(s, (value as Record<string, unknown>).amount);
    return s.amountUnit === 'tiyn' ? Money.of(Number(value)) : parseMajorAmount(value as string | number);
  }

  async initiate(payment: GatewayPayment): Promise<GatewayInitiation> {
    const s = await this.load();
    const expiresAt = new Date(this.clock.now().getTime() + s.paymentTtlMinutes * 60_000);
    const res = await this.http.request<Record<string, unknown>>({
      integration: KASPI_SETTINGS_KEY,
      operation: 'create_payment',
      method: 'POST',
      url: this.url(s, s.createPath, payment),
      headers: this.headers(s),
      body: {
        merchantId: s.merchantId,
        orderId: String(payment.invoiceNo),
        amount: this.amountOut(s, payment.amount),
        currency: payment.amount.currency,
        description: payment.description,
        returnUrl: this.links.returnUrl(payment.returnUrl),
        callbackUrl: this.links.webhookUrl(KASPI_PROVIDER),
        expiresAt: expiresAt.toISOString(),
        customer: { phone: payment.customer.phone },
      },
      correlationId: payment.paymentId,
    });
    const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>;
    const externalId = pick(body, 'paymentId', 'id', 'transactionId', 'externalId');
    const paymentUrl = pick(body, 'paymentUrl', 'url', 'qrUrl', 'link', 'redirectUrl');
    if (!externalId || !paymentUrl) {
      throw new ExternalServiceError(KASPI_SETTINGS_KEY, 'create_payment: unexpected response (no id or url)', false, res.status, res.body);
    }
    const providerExpiry = pick(body, 'expiresAt', 'expireDate');
    const parsedExpiry = providerExpiry ? new Date(providerExpiry) : null;
    return {
      externalId,
      paymentUrl,
      expiresAt: parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry : expiresAt,
      providerData: { orderId: String(payment.invoiceNo) },
    };
  }

  async fetchStatus(payment: GatewayPayment): Promise<GatewayStatus> {
    const s = await this.load();
    const res = await this.http.request<Record<string, unknown>>({
      integration: KASPI_SETTINGS_KEY,
      operation: 'payment_status',
      method: 'GET',
      url: this.url(s, s.statusPath, payment),
      headers: this.headers(s),
      correlationId: payment.paymentId,
    });
    const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>;
    return {
      status: mapKaspiStatus(body.status ?? body.state, s.statusMap),
      amount: this.amountIn(s, body.amount),
      reason: pick(body, 'reason', 'message', 'error'),
    };
  }

  async refund(payment: GatewayPayment, amount: Money, refundId: string): Promise<GatewayRefundResult> {
    const s = await this.load();
    const res = await this.http.request<Record<string, unknown>>({
      integration: KASPI_SETTINGS_KEY,
      operation: 'refund',
      method: 'POST',
      url: this.url(s, s.refundPath, payment),
      headers: { ...this.headers(s), 'idempotency-key': refundId },
      body: { merchantId: s.merchantId, orderId: String(payment.invoiceNo), refundId, amount: this.amountOut(s, amount), currency: amount.currency },
      correlationId: payment.paymentId,
    });
    const body = (res.body && typeof res.body === 'object' ? res.body : {}) as Record<string, unknown>;
    const status = body.status !== undefined ? mapKaspiStatus(body.status, s.statusMap) : 'succeeded';
    if (status === 'failed' || status === 'cancelled') {
      throw new ExternalServiceError(KASPI_SETTINGS_KEY, `refund rejected: ${pick(body, 'reason', 'message') ?? status}`, false, res.status, res.body);
    }
    return { externalRefundId: pick(body, 'refundId', 'id') ?? refundId };
  }

  async verifyWebhook(request: WebhookRequest): Promise<GatewayNotification> {
    const s = await this.load();
    if (!verifyKaspiSignature(s.webhookSecret, request.rawBody, request.headers[s.signatureHeader.toLowerCase()])) {
      throw new ForbiddenError('payment.webhook_signature_invalid', 'Invalid webhook signature');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    const externalId = pick(body, 'paymentId', 'externalId', 'transactionId', 'id');
    if (!externalId) throw new ValidationError('payment.webhook_invalid', 'Webhook has no payment id');
    const status = mapKaspiStatus(body.status ?? body.state, s.statusMap);
    return {
      eventId: pick(body, 'eventId', 'notificationId') ?? `${externalId}:${String(body.status ?? body.state ?? 'unknown')}`,
      externalId,
      status,
      amount: this.amountIn(s, body.amount),
      reason: status === 'failed' || status === 'cancelled' ? pick(body, 'reason', 'message') : null,
    };
  }
}
