import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { ExternalServiceError } from '../../../shared/infrastructure/integrations/external-http';
import { Clock } from '../../../shared/kernel/clock';
import { Delivery, DeliveryStep, FailureKind, MESSAGE_FSM, MessageStatus, aggregateMessageStatus } from '../domain/delivery';
import { planGuestDeliveries, PlannedDelivery } from '../domain/delivery-plan';
import { maskAddress, maskParams } from '../domain/masking';
import { TemplateInfo, templateInfo } from '../domain/templates';
import { DeliveryRecord, DeliveryRepository, MessageRecord, MessageRepository } from '../infrastructure/message.repository';
import { SecretRedaction } from '../infrastructure/redaction';
import { ChannelNotConfiguredError, ChannelSendResult, RenderedContent } from './channel-adapter';
import { ChannelRegistry } from './channel-registry';
import { MessageSecrets } from './message-secrets';
import { toNewDelivery } from './queue-notification.action';
import { StaffAudienceResolver } from './staff-audience';
import { TemplateRenderer } from './template-renderer';

/** Лимит запусков задачи доставки (policy @JobHandler): цепочка до 4 каналов x 3 попытки + запас. */
export const DELIVER_JOB_ATTEMPTS = 15;
/** Аренда сообщения на время одного запуска задачи. */
const LEASE_MS = 10 * 60_000;

/** Задача должна быть повторена позже (временный сбой канала или сообщение занято другим процессом). */
export class DeliveryRetryScheduled extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeliveryRetryScheduled';
  }
}

interface ClassifiedFailure {
  kind: FailureKind;
  code: string;
  message: string;
}

export function classifyChannelFailure(err: unknown): ClassifiedFailure {
  if (err instanceof ChannelNotConfiguredError) {
    return { kind: 'not_configured', code: 'channel.not_configured', message: err.reason };
  }
  if (err instanceof ExternalServiceError) {
    return {
      kind: err.retryable ? 'retryable' : 'permanent',
      code: err.statusCode ? `http_${err.statusCode}` : 'provider_error',
      message: err.message,
    };
  }
  // Непредвиденная ошибка (хранилище файлов, сеть внутри адаптера) — считаем временной.
  return { kind: 'retryable', code: 'internal', message: err instanceof Error ? err.message : String(err) };
}

type DeliveryOutcome = 'sent' | 'failed' | 'retry';

/**
 * Доставка сообщения (задача notifications.deliver): разрешить адресатов (персонал — по правам на момент
 * доставки), отрисовать шаблон для канала, отправить через адаптер, при ошибке — повтор или резервный канал.
 * Итог по каждой попытке — в журнале попыток; статус сообщения — по итогам доставок.
 */
@Injectable()
export class DeliverMessage {
  private readonly logger = new Logger(DeliverMessage.name);

  constructor(
    private readonly messages: MessageRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly audience: StaffAudienceResolver,
    private readonly channels: ChannelRegistry,
    private readonly renderer: TemplateRenderer,
    private readonly secrets: MessageSecrets,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(messageId: string): Promise<MessageStatus | null> {
    const now = this.clock.now();
    const message = await this.messages.claim(messageId, now, new Date(now.getTime() + LEASE_MS));
    if (!message) {
      const current = await this.messages.findById(messageId);
      if (current && current.status === MessageStatus.Queued) {
        // Сообщение обрабатывает другой запуск (или провайдер вернул его в очередь во время отправки).
        throw new DeliveryRetryScheduled(`Message ${messageId} is being delivered by another worker`);
      }
      return current?.status ?? null;
    }
    let retry = false;
    try {
      retry = await this.process(message);
    } finally {
      await this.messages.release(messageId);
    }
    const status = await this.finish(messageId);
    if (retry) throw new DeliveryRetryScheduled(`Message ${messageId}: temporary channel failure, will retry`);
    return status;
  }

  private async process(message: MessageRecord): Promise<boolean> {
    const info = templateInfo(message.template);
    if (!message.plannedAt) await this.plan(message);
    const pending = (await this.deliveries.forMessage(message.id)).filter((d) => d.status === 'pending');
    if (pending.length === 0) return false;

    const secret = this.secrets.open(message.secretParams);
    const params = { ...message.params, ...secret };
    const expired = !!message.expiresAt && this.clock.now().getTime() > message.expiresAt.getTime();
    // Последний разрешённый запуск задачи: временные ошибки больше не повторяются.
    const allowRetry = message.jobRuns < DELIVER_JOB_ATTEMPTS;
    let retry = false;
    for (const record of pending) {
      if (!info) {
        await this.failDelivery(message, record, 'template.unknown', `Unknown template ${message.template}`);
        continue;
      }
      if (expired) {
        await this.failDelivery(message, record, 'message.expired', 'Message expired before it could be delivered');
        continue;
      }
      const outcome = await this.deliver(message, info, record, params, Object.values(secret), allowRetry);
      if (outcome === 'retry') retry = true;
    }
    return retry;
  }

  /** Адресаты сообщения: гость — по плану каналов, персонал — по правам и настройкам филиала. */
  private async plan(message: MessageRecord): Promise<void> {
    let planned: PlannedDelivery[];
    const recipient = message.recipient;
    if (recipient.kind === 'guest') {
      planned = planGuestDeliveries(recipient, message.channelPlan);
    } else if (recipient.kind === 'staff') {
      planned = await this.audience.resolve({
        branchId: recipient.branchId,
        permission: recipient.permission,
        userIds: recipient.userIds ?? [],
        includeBranchChannels: recipient.includeBranchChannels,
      });
    } else {
      planned = [
        {
          targetKind: 'direct',
          staffUserId: null,
          recipientName: recipient.name,
          chain: recipient.address ? [{ channel: recipient.channel, address: recipient.address }] : [],
          requestedChannel: recipient.channel,
        },
      ];
    }
    const now = this.clock.now();
    await this.database.transaction(async () => {
      await this.deliveries.insertMany(message.id, planned.map(toNewDelivery), now);
      await this.messages.markPlanned(message.id, now);
    });
    if (planned.length === 0) {
      this.logger.warn({ messageId: message.id, template: message.template }, 'Notification has no recipients');
    }
  }

  private async deliver(
    message: MessageRecord,
    info: TemplateInfo,
    record: DeliveryRecord,
    params: Record<string, string>,
    secretValues: string[],
    allowRetry: boolean,
  ): Promise<DeliveryOutcome> {
    const delivery = new Delivery({
      status: record.status,
      chain: record.chain,
      stepIndex: record.stepIndex,
      attempts: record.attempts,
      channelAttempts: record.channelAttempts,
    });
    const masked = maskParams(params, info.sensitive);
    while (delivery.isPending) {
      const step = delivery.current;
      const adapter = this.channels.adapter(step.channel);
      if (!adapter || !(await adapter.isConfigured())) {
        const decision = delivery.registerFailure('not_configured', { allowRetry });
        await this.persistAttempt(message, record, delivery, step, {
          status: 'skipped',
          provider: null,
          errorCode: 'channel.not_configured',
          error: 'Channel is not configured',
        });
        if (decision === 'exhausted') break;
        continue;
      }

      let content: RenderedContent;
      let preview: RenderedContent;
      try {
        const text = await this.renderer.resolve(message.template, step.channel, message.locale);
        content = this.renderer.renderResolved(message.template, step.channel, text, params);
        preview = this.renderer.renderResolved(message.template, step.channel, text, masked);
      } catch (err) {
        const decision = delivery.registerFailure('permanent', { allowRetry });
        await this.persistAttempt(message, record, delivery, step, {
          status: 'failed',
          provider: null,
          errorCode: 'template.render_failed',
          error: err instanceof Error ? err.message : String(err),
        });
        if (decision === 'exhausted') break;
        continue;
      }

      const started = Date.now();
      try {
        const result = await SecretRedaction.run(secretValues, () =>
          adapter.send({
            deliveryId: record.id,
            channel: step.channel,
            to: step.address,
            locale: message.locale,
            template: message.template,
            params,
            paramOrder: info.params,
            content,
            attachments: message.attachments,
          }),
        );
        delivery.markSent();
        await this.persistSent(message, record, delivery, step, result, preview, Date.now() - started);
        return 'sent';
      } catch (err) {
        const failure = classifyChannelFailure(err);
        const decision = delivery.registerFailure(failure.kind, { allowRetry });
        await this.persistAttempt(message, record, delivery, step, {
          status: failure.kind === 'not_configured' ? 'skipped' : 'failed',
          provider: failure.kind === 'not_configured' ? null : this.providerOf(err),
          errorCode: failure.code,
          error: failure.message,
          retryable: failure.kind === 'retryable',
          durationMs: Date.now() - started,
          preview,
        });
        this.logger.warn(
          { messageId: message.id, deliveryId: record.id, channel: step.channel, decision, err: failure.message },
          'Notification delivery attempt failed',
        );
        if (decision === 'retry') return 'retry';
        if (decision === 'exhausted') break;
      }
    }
    if (!delivery.isPending) return delivery.status === 'sent' ? 'sent' : 'failed';

    // Каналы исчерпаны. Вне продакшена ненастроенный канал пишет сообщение в журнал приложения.
    const fallback = this.channels.fallbackLog();
    const unconfigured = fallback ? await this.firstUnconfiguredStep(delivery) : null;
    if (fallback && unconfigured) {
      const text = await this.renderer.resolve(message.template, unconfigured.channel, message.locale);
      const content = this.renderer.renderResolved(message.template, unconfigured.channel, text, params);
      const preview = this.renderer.renderResolved(message.template, unconfigured.channel, text, masked);
      const result = await fallback.send({
        deliveryId: record.id,
        channel: unconfigured.channel,
        to: unconfigured.address,
        locale: message.locale,
        template: message.template,
        params,
        paramOrder: info.params,
        content,
        attachments: message.attachments,
      });
      delivery.moveTo(unconfigured);
      delivery.markSent();
      await this.persistSent(message, record, delivery, unconfigured, result, preview, 0);
      return 'sent';
    }
    delivery.fail();
    await this.deliveries.save(record.id, { status: delivery.status });
    return 'failed';
  }

  private async firstUnconfiguredStep(delivery: Delivery): Promise<DeliveryStep | null> {
    for (const step of delivery.snapshot().chain) {
      if (!(await this.channels.isConfigured(step.channel))) return step;
    }
    return null;
  }

  /** Код провайдера по ключу интеграции ошибки: 'notifications.<провайдер>' -> '<провайдер>'. */
  private providerOf(err: unknown): string | null {
    return err instanceof ExternalServiceError ? (err.integration.split('.').pop() ?? err.integration) : null;
  }

  private async persistSent(
    message: MessageRecord,
    record: DeliveryRecord,
    delivery: Delivery,
    step: DeliveryStep,
    result: ChannelSendResult,
    preview: RenderedContent,
    durationMs: number,
  ): Promise<void> {
    const state = delivery.snapshot();
    const now = this.clock.now();
    await this.database.transaction(async () => {
      await this.deliveries.insertAttempt({
        deliveryId: record.id,
        messageId: message.id,
        attemptNo: await this.deliveries.nextAttemptNo(record.id),
        channel: step.channel,
        provider: result.provider,
        addressMasked: maskAddress(step.channel, step.address),
        status: 'sent',
        retryable: false,
        errorCode: null,
        error: null,
        externalId: result.externalId,
        durationMs,
        occurredAt: now,
      });
      await this.deliveries.save(record.id, {
        status: state.status,
        stepIndex: state.stepIndex,
        channel: step.channel,
        address: step.address,
        attempts: state.attempts,
        channelAttempts: state.channelAttempts,
        provider: result.provider,
        externalId: result.externalId,
        lastError: null,
        sentAt: now,
        renderedSubject: preview.subject,
        renderedText: preview.text,
      });
      await this.messages.addAttempts(message.id, 1);
    });
  }

  private async persistAttempt(
    message: MessageRecord,
    record: DeliveryRecord,
    delivery: Delivery,
    step: DeliveryStep,
    attempt: {
      status: 'failed' | 'skipped';
      provider: string | null;
      errorCode: string;
      error: string;
      retryable?: boolean;
      durationMs?: number;
      preview?: RenderedContent;
    },
  ): Promise<void> {
    const state = delivery.snapshot();
    const current = delivery.current;
    await this.database.transaction(async () => {
      await this.deliveries.insertAttempt({
        deliveryId: record.id,
        messageId: message.id,
        attemptNo: await this.deliveries.nextAttemptNo(record.id),
        channel: step.channel,
        provider: attempt.provider,
        addressMasked: maskAddress(step.channel, step.address),
        status: attempt.status,
        retryable: attempt.retryable ?? false,
        errorCode: attempt.errorCode,
        error: attempt.error,
        externalId: null,
        durationMs: attempt.durationMs ?? null,
        occurredAt: this.clock.now(),
      });
      await this.deliveries.save(record.id, {
        stepIndex: state.stepIndex,
        channel: current.channel,
        address: current.address,
        attempts: state.attempts,
        channelAttempts: state.channelAttempts,
        lastError: `${attempt.errorCode}: ${attempt.error}`.slice(0, 1000),
        ...(attempt.preview ? { renderedSubject: attempt.preview.subject, renderedText: attempt.preview.text } : {}),
      });
      if (attempt.status === 'failed') await this.messages.addAttempts(message.id, 1);
    });
  }

  private async failDelivery(message: MessageRecord, record: DeliveryRecord, code: string, error: string): Promise<void> {
    const delivery = new Delivery({
      status: record.status,
      chain: record.chain,
      stepIndex: record.stepIndex,
      attempts: record.attempts,
      channelAttempts: record.channelAttempts,
    });
    delivery.fail();
    const step = delivery.current;
    await this.database.transaction(async () => {
      await this.deliveries.insertAttempt({
        deliveryId: record.id,
        messageId: message.id,
        attemptNo: await this.deliveries.nextAttemptNo(record.id),
        channel: step.channel,
        provider: null,
        addressMasked: maskAddress(step.channel, step.address),
        status: 'skipped',
        retryable: false,
        errorCode: code,
        error,
        externalId: null,
        durationMs: null,
        occurredAt: this.clock.now(),
      });
      await this.deliveries.save(record.id, { status: delivery.status, lastError: `${code}: ${error}` });
    });
  }

  /** Итоговый статус сообщения, когда незавершённых доставок не осталось. */
  private async finish(messageId: string): Promise<MessageStatus | null> {
    const message = await this.messages.findById(messageId);
    if (!message) return null;
    if (message.status !== MessageStatus.Queued) return message.status;
    const deliveries = await this.deliveries.forMessage(messageId);
    const status = aggregateMessageStatus(deliveries.map((d) => d.status));
    if (!status) return MessageStatus.Queued;
    MESSAGE_FSM.assertTransition(message.status, status);
    const lastError = status === MessageStatus.Sent ? null : (deliveries.find((d) => d.status === 'failed')?.lastError ?? 'no_recipients');
    const completed = await this.messages.complete(messageId, status, this.clock.now(), lastError);
    return completed ? status : MessageStatus.Queued;
  }
}
