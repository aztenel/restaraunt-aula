import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { safeEqual, SecretBox } from '../../../../../shared/infrastructure/crypto/secret-box';
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
import { escapeHtml } from '../html';

export const HALYK_PROVIDER = 'halyk';
export const HALYK_SETTINGS_KEY = 'payments.halyk';

/** Адреса Halyk ePay (production и тестовая среда банка). Можно переопределить в настройках. */
export const HALYK_ENDPOINTS = {
  production: {
    oauthUrl: 'https://epay-oauth.homebank.kz/oauth2/token',
    apiUrl: 'https://epay-api.homebank.kz',
    paymentScriptUrl: 'https://epay.homebank.kz/payform/payment-api.js',
  },
  test: {
    oauthUrl: 'https://test-epay.homebank.kz/oauth2/token',
    apiUrl: 'https://test-epay.homebank.kz/api',
    paymentScriptUrl: 'https://test-epay.homebank.kz/payform/payment-api.js',
  },
} as const;

const DEFAULT_SCOPE = 'webapi usermanagement email_send verification statement statistics payment';

const bool = z.union([z.boolean(), z.string()]).transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

export const HalykSettingsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  terminalId: z.string().min(1),
  testMode: bool.default(false),
  oauthUrl: z.string().url().optional(),
  apiUrl: z.string().url().optional(),
  paymentScriptUrl: z.string().url().optional(),
  paymentTtlMinutes: z.coerce.number().int().min(5).max(1440).default(20),
  language: z.enum(['rus', 'kaz', 'eng']).default('rus'),
  scope: z.string().min(1).default(DEFAULT_SCOPE),
});
export type HalykSettings = z.infer<typeof HalykSettingsSchema>;

export const HALYK_DESCRIPTOR: IntegrationDescriptor = {
  key: HALYK_SETTINGS_KEY,
  title: 'Halyk ePay',
  category: 'payments',
  stage: 1,
  description:
    'Интернет-эквайринг Halyk Bank (ePay): OAuth2 client_credentials, платёжный виджет на странице оплаты, ' +
    'postLink/failurePostLink с проверкой secret_hash, проверка статуса и возвраты через API. ' +
    'Тестовая среда банка включается флагом testMode (адреса можно переопределить).',
  fields: [
    { name: 'clientId', label: 'Client ID', type: 'string', required: true },
    { name: 'clientSecret', label: 'Client secret', type: 'string', secret: true, required: true },
    { name: 'terminalId', label: 'Terminal ID', type: 'string', required: true },
    { name: 'testMode', label: 'Тестовая среда банка', type: 'boolean' },
    { name: 'oauthUrl', label: 'OAuth URL (переопределение)', type: 'url' },
    { name: 'apiUrl', label: 'API URL (переопределение)', type: 'url' },
    { name: 'paymentScriptUrl', label: 'URL скрипта виджета (переопределение)', type: 'url' },
    { name: 'paymentTtlMinutes', label: 'Срок жизни страницы оплаты, минут', type: 'number', help: 'По умолчанию 20' },
    { name: 'language', label: 'Язык страницы оплаты', type: 'select', options: ['rus', 'kaz', 'eng'] },
  ],
};

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  token_type?: string;
  scope?: string;
  refresh_token?: string;
}

/** Статусы транзакции Halyk -> наш статус. AUTH (двухстадийный терминал) считается оплатой. */
export function mapHalykStatus(statusName: string | null | undefined): GatewayPaymentStatus {
  switch ((statusName ?? '').toUpperCase()) {
    case 'CHARGE':
    case 'AUTH':
    case 'REFUND':
    case 'PARTIAL_REFUND':
      return 'succeeded';
    case 'CANCEL':
    case 'CANCEL_OLD':
      return 'cancelled';
    case 'REJECT':
    case 'FAILED':
    case 'DECLINE':
    case 'DECLINED':
      return 'failed';
    default:
      return 'pending';
  }
}

/** invoiceID Halyk — 6..15 цифр. */
export function halykInvoiceId(invoiceNo: number): string {
  return String(invoiceNo).padStart(6, '0');
}

function str(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

/**
 * Halyk ePay. Карточные данные вводятся только на стороне банка (виджет payment-api.js):
 * наш сервер их не видит. Подпись уведомлений — secret_hash, который мы передаём при получении
 * токена (HMAC от номера счёта с ключом приложения) и сверяем в postLink.
 */
@Injectable()
export class HalykGateway extends PaymentGateway {
  readonly provider = HALYK_PROVIDER;
  private serviceToken: { token: string; clientId: string; expiresAt: number } | null = null;

  constructor(
    private readonly settings: IntegrationSettings,
    private readonly http: ExternalHttp,
    private readonly box: SecretBox,
    private readonly links: PaymentLinks,
    private readonly clock: Clock,
  ) {
    super();
  }

  /** Настройки для операций по существующим платежам — даже если провайдер выключен для новых. */
  private async load(): Promise<HalykSettings & { oauthUrl: string; apiUrl: string; paymentScriptUrl: string }> {
    const raw = await this.settings.getRaw(HALYK_SETTINGS_KEY);
    const parsed = HalykSettingsSchema.safeParse({ ...(raw?.config ?? {}), ...(raw?.secrets ?? {}) });
    if (!raw || !parsed.success) {
      throw new ValidationError('integration.misconfigured', `Integration ${HALYK_SETTINGS_KEY} is not configured`);
    }
    const defaults = parsed.data.testMode ? HALYK_ENDPOINTS.test : HALYK_ENDPOINTS.production;
    return {
      ...parsed.data,
      oauthUrl: parsed.data.oauthUrl ?? defaults.oauthUrl,
      apiUrl: (parsed.data.apiUrl ?? defaults.apiUrl).replace(/\/$/, ''),
      paymentScriptUrl: parsed.data.paymentScriptUrl ?? defaults.paymentScriptUrl,
    };
  }

  async isEnabled(): Promise<boolean> {
    const raw = await this.settings.getRaw(HALYK_SETTINGS_KEY);
    return !!raw?.enabled && HalykSettingsSchema.safeParse({ ...raw.config, ...raw.secrets }).success;
  }

  /** secret_hash для счёта: без состояния, проверяется по invoiceId из уведомления. */
  secretHash(invoiceId: string): string {
    return this.box.hmac(`halyk:secret_hash:${invoiceId}`).slice(0, 48);
  }

  private tokenForm(s: HalykSettings, extra: Record<string, string>): URLSearchParams {
    return new URLSearchParams({
      grant_type: 'client_credentials',
      scope: s.scope,
      client_id: s.clientId,
      client_secret: s.clientSecret,
      ...extra,
    });
  }

  private async requestToken(s: Awaited<ReturnType<HalykGateway['load']>>, form: URLSearchParams, correlationId: string, operation: string) {
    const res = await this.http.request<TokenResponse>({
      integration: HALYK_SETTINGS_KEY,
      operation,
      method: 'POST',
      url: s.oauthUrl,
      body: form,
      correlationId,
    });
    const token = res.body;
    if (!token || typeof token !== 'object' || !token.access_token) {
      throw new ExternalServiceError(HALYK_SETTINGS_KEY, `${operation}: no access_token in response`, false, res.status, res.body);
    }
    return token;
  }

  /** Токен для API (статус, возврат): без привязки к счёту, кэшируется до истечения. */
  private async apiToken(s: Awaited<ReturnType<HalykGateway['load']>>, correlationId: string): Promise<string> {
    const now = this.clock.now().getTime();
    if (this.serviceToken && this.serviceToken.clientId === s.clientId && this.serviceToken.expiresAt > now) {
      return this.serviceToken.token;
    }
    const token = await this.requestToken(s, this.tokenForm(s, {}), correlationId, 'token');
    const ttl = Math.max(60, Number(token.expires_in ?? 600) - 60);
    this.serviceToken = { token: token.access_token!, clientId: s.clientId, expiresAt: now + ttl * 1000 };
    return this.serviceToken.token;
  }

  async initiate(payment: GatewayPayment): Promise<GatewayInitiation> {
    const s = await this.load();
    const invoiceId = halykInvoiceId(payment.invoiceNo);
    const webhook = this.links.webhookUrl(HALYK_PROVIDER);
    const token = await this.requestToken(
      s,
      this.tokenForm(s, {
        invoiceID: invoiceId,
        secret_hash: this.secretHash(invoiceId),
        amount: toMajorString(payment.amount),
        currency: payment.amount.currency,
        terminal: s.terminalId,
        postLink: webhook,
        failurePostLink: webhook,
      }),
      payment.paymentId,
      'payment_token',
    );
    const tokenTtlMs = Number(token.expires_in ?? 0) * 1000;
    const ttlMs = s.paymentTtlMinutes * 60_000;
    return {
      externalId: invoiceId,
      paymentUrl: this.links.checkoutUrl(payment.paymentId),
      expiresAt: new Date(this.clock.now().getTime() + (tokenTtlMs > 0 ? Math.min(ttlMs, tokenTtlMs) : ttlMs)),
      // Токен страницы оплаты — только зашифрованным (нужен виджету на странице checkout).
      providerData: { invoiceId, checkoutToken: this.box.encrypt(JSON.stringify(token)) },
    };
  }

  /** Страница с виджетом Halyk: карта вводится на стороне банка. */
  override async checkoutPage(payment: GatewayPayment): Promise<string | null> {
    const encrypted = payment.providerData.checkoutToken;
    if (typeof encrypted !== 'string') return null;
    const s = await this.load();
    const auth = JSON.parse(this.box.decrypt(encrypted)) as TokenResponse;
    const back = this.links.returnUrl(payment.returnUrl);
    const webhook = this.links.webhookUrl(HALYK_PROVIDER);
    const paymentObject = {
      invoiceId: halykInvoiceId(payment.invoiceNo),
      backLink: back,
      failureBackLink: back,
      postLink: webhook,
      failurePostLink: webhook,
      language: s.language,
      description: payment.description,
      accountId: payment.customer.phone ?? payment.paymentId,
      terminal: s.terminalId,
      amountText: toMajorString(payment.amount),
      currency: payment.amount.currency,
      name: payment.customer.name ?? '',
      email: payment.customer.email ?? '',
      phone: payment.customer.phone ?? '',
      auth,
    };
    const json = JSON.stringify(paymentObject).replace(/</g, '\\u003c');
    return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>AULA — оплата</title>
<script src="${escapeHtml(s.paymentScriptUrl)}"></script></head>
<body><p style="font-family:sans-serif;text-align:center;margin-top:40px">Переход к оплате…</p>
<script>var p=${json};p.amount=Number(p.amountText);delete p.amountText;halyk.pay(p);</script></body></html>`;
  }

  async fetchStatus(payment: GatewayPayment): Promise<GatewayStatus> {
    const s = await this.load();
    const invoiceId = payment.externalId ?? halykInvoiceId(payment.invoiceNo);
    const token = await this.apiToken(s, payment.paymentId);
    const res = await this.http.request<any>({
      integration: HALYK_SETTINGS_KEY,
      operation: 'check_status',
      method: 'GET',
      url: `${s.apiUrl}/check-status/payment/transaction/${encodeURIComponent(invoiceId)}`,
      headers: { authorization: `Bearer ${token}` },
      correlationId: payment.paymentId,
    });
    const body = res.body ?? {};
    // resultCode 100 — транзакция найдена; прочие коды — гость ещё не платил / операция в обработке.
    if (String(body.resultCode) !== '100' || !body.transaction) return { status: 'pending', amount: null };
    const tx = body.transaction;
    return {
      status: mapHalykStatus(tx.statusName),
      amount: tx.amount !== undefined && tx.amount !== null ? parseMajorAmount(tx.amount) : null,
      reason: str(tx.reason),
      providerData: { transactionId: str(tx.id), cardMask: str(tx.cardMask), reference: str(tx.reference) },
    };
  }

  async refund(payment: GatewayPayment, amount: Money, refundId: string): Promise<GatewayRefundResult> {
    const s = await this.load();
    let transactionId = str(payment.providerData.transactionId);
    if (!transactionId) {
      transactionId = str((await this.fetchStatus(payment)).providerData?.transactionId);
    }
    if (!transactionId) {
      throw new ExternalServiceError(HALYK_SETTINGS_KEY, 'Refund: transaction id is unknown', false);
    }
    const token = await this.apiToken(s, payment.paymentId);
    await this.http.request({
      integration: HALYK_SETTINGS_KEY,
      operation: 'refund',
      method: 'POST',
      url: `${s.apiUrl}/operation/${encodeURIComponent(transactionId)}/refund?amount=${toMajorString(amount)}`,
      headers: { authorization: `Bearer ${token}`, 'x-idempotency-key': refundId },
      correlationId: payment.paymentId,
    });
    return { externalRefundId: `${transactionId}:${refundId}` };
  }

  /**
   * postLink / failurePostLink. Проверка подписи: secret_hash из тела равен HMAC номера счёта.
   * Не зависит от сырого тела запроса (поле в JSON), поэтому точна и без rawBody.
   */
  async verifyWebhook(request: WebhookRequest): Promise<GatewayNotification> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const invoiceId = str(body.invoiceId ?? body.invoiceID);
    const secret = str(body.secret_hash ?? body.secretHash);
    if (!invoiceId || !secret || !safeEqual(this.secretHash(invoiceId), secret)) {
      throw new ForbiddenError('payment.webhook_signature_invalid', 'Invalid webhook signature');
    }
    const code = (str(body.code) ?? '').toLowerCase();
    const status: GatewayPaymentStatus = code === 'ok' ? 'succeeded' : 'failed';
    const transactionId = str(body.id);
    return {
      eventId: `${transactionId ?? 'no-id'}:${code || 'unknown'}:${invoiceId}`,
      externalId: invoiceId,
      status,
      amount: body.amount !== undefined && body.amount !== null && body.amount !== '' ? parseMajorAmount(body.amount as string | number) : null,
      reason: status === 'failed' ? (str(body.reason) ?? str(body.reasonCode) ?? 'declined') : null,
      providerData: {
        ...(transactionId ? { transactionId } : {}),
        ...(str(body.cardMask) ? { cardMask: str(body.cardMask) } : {}),
        ...(str(body.reference) ? { reference: str(body.reference) } : {}),
        ...(str(body.approvalCode) ? { approvalCode: str(body.approvalCode) } : {}),
      },
    };
  }

  override webhookAck(): Record<string, unknown> {
    return { status: 'ok' };
  }
}
