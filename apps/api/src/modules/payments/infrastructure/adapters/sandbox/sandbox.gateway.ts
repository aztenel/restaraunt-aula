import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Config } from '../../../../../shared/infrastructure/config/config';
import { hmacSha256, safeEqual, SecretBox } from '../../../../../shared/infrastructure/crypto/secret-box';
import { ExternalServiceError } from '../../../../../shared/infrastructure/integrations/external-http';
import { IntegrationDescriptor } from '../../../../../shared/infrastructure/settings/integration-catalog';
import { IntegrationSettings } from '../../../../../shared/infrastructure/settings/integration-settings';
import { Clock } from '../../../../../shared/kernel/clock';
import { ForbiddenError, ValidationError } from '../../../../../shared/kernel/errors';
import { Money } from '../../../../../shared/kernel/money';
import { PaymentLinks } from '../../../application/payment-links';
import {
  GatewayInitiation,
  GatewayNotification,
  GatewayPayment,
  GatewayRefundResult,
  GatewayStatus,
  PaymentGateway,
  WebhookRequest,
} from '../../../domain/payment-gateway';
import { SandboxStore } from './sandbox.store';

export const SANDBOX_PROVIDER = 'sandbox';
export const SANDBOX_SETTINGS_KEY = 'payments.sandbox';
export const SANDBOX_SIGNATURE_HEADER = 'x-sandbox-signature';

const SandboxSettingsSchema = z.object({
  webhookSecret: z.string().min(16).optional(),
  paymentTtlMinutes: z.coerce.number().int().min(1).max(1440).default(30),
});
type SandboxSettings = z.infer<typeof SandboxSettingsSchema>;

export const SANDBOX_DESCRIPTOR: IntegrationDescriptor = {
  key: SANDBOX_SETTINGS_KEY,
  title: 'Тестовый платёжный провайдер (песочница)',
  category: 'payments',
  stage: 1,
  description:
    'Эмуляция провайдера для локальной разработки и staging: страница оплаты с кнопками «Оплатить»/«Отказ» ' +
    'отдаётся нашим API, результат приходит через тот же конвейер вебхуков. В production отключена всегда.',
  fields: [
    { name: 'paymentTtlMinutes', label: 'Срок жизни страницы оплаты, минут', type: 'number', help: 'По умолчанию 30' },
    { name: 'webhookSecret', label: 'Секрет подписи вебхуков', type: 'string', secret: true, help: 'Необязательно: по умолчанию выводится из ключа приложения' },
  ],
};

/** Схема тела вебхука песочницы. */
const SandboxWebhookSchema = z.object({
  eventId: z.string().min(1),
  externalId: z.string().min(1),
  status: z.enum(['succeeded', 'failed', 'cancelled', 'pending']),
  amount: z.object({ amount: z.number().int(), currency: z.literal('KZT') }).nullable().optional(),
  reason: z.string().optional(),
});
export type SandboxWebhookBody = z.infer<typeof SandboxWebhookSchema>;

/**
 * Песочница: провайдер без сети. Страница оплаты — GET /public/payments/sandbox/:paymentId,
 * оплата/отказ имитирует вебхук, подписанный HMAC-SHA256 (заголовок x-sandbox-signature).
 */
@Injectable()
export class SandboxGateway extends PaymentGateway {
  readonly provider = SANDBOX_PROVIDER;
  override readonly devFallback = true;

  constructor(
    private readonly settings: IntegrationSettings,
    private readonly config: Config,
    private readonly box: SecretBox,
    private readonly store: SandboxStore,
    private readonly links: PaymentLinks,
    private readonly clock: Clock,
  ) {
    super();
  }

  private async load(): Promise<SandboxSettings> {
    const raw = await this.settings.getRaw(SANDBOX_SETTINGS_KEY);
    const parsed = SandboxSettingsSchema.safeParse({ ...(raw?.config ?? {}), ...(raw?.secrets ?? {}) });
    if (!parsed.success) {
      throw new ValidationError('integration.misconfigured', `Integration ${SANDBOX_SETTINGS_KEY} is misconfigured`);
    }
    return parsed.data;
  }

  private assertAllowed(): void {
    if (this.config.isProduction) {
      throw new ExternalServiceError(SANDBOX_SETTINGS_KEY, 'Sandbox provider is disabled in production', false);
    }
  }

  /** Включена вне production, если настройка не выключена явно. */
  async isEnabled(): Promise<boolean> {
    if (this.config.isProduction) return false;
    const raw = await this.settings.getRaw(SANDBOX_SETTINGS_KEY);
    return raw ? raw.enabled : true;
  }

  async initiate(payment: GatewayPayment): Promise<GatewayInitiation> {
    this.assertAllowed();
    const settings = await this.load();
    const externalId = `sbx_${payment.invoiceNo}`;
    await this.store.open(externalId, payment.paymentId, payment.amount);
    return {
      externalId,
      paymentUrl: this.links.publicApiUrl(`/public/payments/sandbox/${payment.paymentId}?sig=${this.links.signature(payment.paymentId)}`),
      expiresAt: new Date(this.clock.now().getTime() + settings.paymentTtlMinutes * 60_000),
    };
  }

  async fetchStatus(payment: GatewayPayment): Promise<GatewayStatus> {
    this.assertAllowed();
    const session = payment.externalId ? await this.store.get(payment.externalId) : null;
    if (!session) return { status: 'pending', amount: null };
    return { status: session.status, amount: session.amount };
  }

  async refund(payment: GatewayPayment, amount: Money, refundId: string): Promise<GatewayRefundResult> {
    this.assertAllowed();
    if (!payment.externalId || !(await this.store.refund(payment.externalId, amount))) {
      throw new ExternalServiceError(SANDBOX_SETTINGS_KEY, 'Refund rejected by sandbox', false);
    }
    return { externalRefundId: `sbx_rf_${refundId}` };
  }

  async secret(): Promise<string> {
    return (await this.load()).webhookSecret ?? this.box.hmac('payments.sandbox.webhook');
  }

  async sign(rawBody: string): Promise<string> {
    return hmacSha256(await this.secret(), rawBody, 'hex');
  }

  async verifyWebhook(request: WebhookRequest): Promise<GatewayNotification> {
    if (this.config.isProduction) throw new ForbiddenError('payment.provider_disabled', 'Sandbox provider is disabled in production');
    const signature = request.headers[SANDBOX_SIGNATURE_HEADER] ?? '';
    if (!safeEqual(await this.sign(request.rawBody), signature)) {
      throw new ForbiddenError('payment.webhook_signature_invalid', 'Invalid webhook signature');
    }
    const parsed = SandboxWebhookSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('payment.webhook_invalid', 'Invalid sandbox webhook body');
    const body = parsed.data;
    return {
      eventId: body.eventId,
      externalId: body.externalId,
      status: body.status,
      amount: body.amount ? Money.of(body.amount.amount, body.amount.currency) : null,
      reason: body.reason ?? null,
    };
  }
}
