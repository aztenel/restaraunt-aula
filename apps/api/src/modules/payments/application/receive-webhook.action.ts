import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { IntegrationLog } from '../../../shared/infrastructure/integrations/integration-log';
import { Clock } from '../../../shared/kernel/clock';
import { DomainError, NotFoundError } from '../../../shared/kernel/errors';
import { GatewayNotification, WebhookRequest } from '../domain/payment-gateway';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { WebhookEventRepository, WebhookOutcome } from '../infrastructure/webhook-event.repository';
import { PaymentGatewayRegistry } from './payment-gateway.registry';
import { ApplyGatewayStatus } from './payment-status.actions';

/** Заголовки, которые пишем в журнал интеграций (значения подписей маскируются журналом). */
const LOGGED_HEADERS = /^(content-type|user-agent|x-forwarded-for|x-request-id|.*signature.*|.*sign.*)$/i;

export interface WebhookResult {
  outcome: WebhookOutcome | 'duplicate';
  paymentId: string | null;
  ack: Record<string, unknown>;
}

/**
 * Входящий вебхук провайдера: проверка подписи адаптером, идемпотентность по (provider, eventId),
 * применение статуса к платежу, полный журнал запроса (с маскированием) в журнале интеграций.
 * Обработка — только запись в БД (без внешних вызовов), поэтому ответ 200 отдаётся быстро.
 */
@Injectable()
export class ReceivePaymentWebhook {
  private readonly logger = new Logger(ReceivePaymentWebhook.name);

  constructor(
    private readonly registry: PaymentGatewayRegistry,
    private readonly payments: PaymentRepository,
    private readonly webhookEvents: WebhookEventRepository,
    private readonly applyStatus: ApplyGatewayStatus,
    private readonly integrationLog: IntegrationLog,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(provider: string, request: WebhookRequest): Promise<WebhookResult> {
    const started = Date.now();
    const gateway = this.registry.find(provider);
    if (!gateway) throw new NotFoundError('payment_provider', provider);
    const logRequest = {
      headers: Object.fromEntries(Object.entries(request.headers).filter(([k]) => LOGGED_HEADERS.test(k))),
      query: request.query,
      body: request.body,
      rawBodyIsExact: request.rawBodyIsExact,
    };

    let notification: GatewayNotification;
    try {
      notification = await gateway.verifyWebhook(request);
    } catch (error) {
      await this.integrationLog.record({
        integration: `payments.${provider}`,
        direction: 'inbound',
        operation: 'webhook',
        request: logRequest,
        response: { rejected: true },
        statusCode: error instanceof DomainError ? 403 : 400,
        success: false,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const result = await this.database.transaction(async (): Promise<WebhookResult> => {
      const eventRowId = await this.webhookEvents.register({
        provider,
        eventId: notification.eventId,
        externalId: notification.externalId,
        status: notification.status,
        amount: notification.amount,
        receivedAt: this.clock.now(),
      });
      const payment = await this.payments.findByExternalId(provider, notification.externalId);
      if (!eventRowId) return { outcome: 'duplicate', paymentId: payment?.id ?? null, ack: gateway.webhookAck() };
      if (!payment) {
        this.logger.warn({ provider, externalId: notification.externalId }, 'Webhook for unknown payment');
        await this.webhookEvents.complete(eventRowId, null, 'unknown_payment');
        return { outcome: 'unknown_payment', paymentId: null, ack: gateway.webhookAck() };
      }
      const outcome = await this.applyStatus.execute(
        payment.id,
        { status: notification.status, amount: notification.amount, reason: notification.reason, providerData: notification.providerData },
        'webhook',
      );
      await this.webhookEvents.complete(eventRowId, payment.id, outcome);
      return { outcome, paymentId: payment.id, ack: gateway.webhookAck() };
    });

    await this.integrationLog.record({
      integration: `payments.${provider}`,
      direction: 'inbound',
      operation: 'webhook',
      correlationId: result.paymentId ?? notification.externalId,
      request: logRequest,
      response: { status: 200, outcome: result.outcome, notification: { ...notification, amount: notification.amount?.toJSON() ?? null } },
      statusCode: 200,
      success: result.outcome !== 'unknown_payment' && result.outcome !== 'amount_mismatch',
      durationMs: Date.now() - started,
      error: result.outcome === 'amount_mismatch' ? 'amount mismatch' : null,
    });
    return result;
  }
}
