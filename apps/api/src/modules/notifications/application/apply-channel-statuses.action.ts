import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { aggregateMessageStatus, Delivery, MESSAGE_FSM, MessageStatus } from '../domain/delivery';
import { maskAddress } from '../domain/masking';
import { DeliveryRepository, MessageRepository } from '../infrastructure/message.repository';
import { ProviderEventRepository } from '../infrastructure/feed.repository';
import { ChannelStatusUpdate } from './channel-status-webhook';
import { DELIVER_JOB, DeliverJobPayload } from './queue-notification.action';

export interface AppliedStatuses {
  applied: number;
  ignored: number;
}

/**
 * Статусы от провайдера (вебхук): «доставлено» и «прочитано» отмечаются в журнале; ошибка уже
 * отправленного сообщения (например, номер не зарегистрирован в WhatsApp) переводит доставку
 * на следующий канал цепочки (SMS) и снова ставит задачу доставки.
 * Идемпотентно: повтор того же статуса того же сообщения ничего не меняет.
 */
@Injectable()
export class ApplyChannelStatuses {
  private readonly logger = new Logger(ApplyChannelStatuses.name);

  constructor(
    private readonly messages: MessageRepository,
    private readonly deliveries: DeliveryRepository,
    private readonly events: ProviderEventRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(updates: ChannelStatusUpdate[]): Promise<AppliedStatuses> {
    const result: AppliedStatuses = { applied: 0, ignored: 0 };
    for (const update of updates) {
      const applied = await this.database.transaction(() => this.applyOne(update));
      if (applied) result.applied += 1;
      else result.ignored += 1;
    }
    return result;
  }

  private async applyOne(update: ChannelStatusUpdate): Promise<boolean> {
    if (!(await this.events.markProcessed(`${update.provider}:${update.externalId}:${update.status}`))) return false;
    const found = await this.deliveries.findByExternalId(update.provider, update.externalId);
    if (!found) return false;
    const record = await this.deliveries.lockForUpdate(found.id);
    if (!record) return false;
    const at = update.occurredAt ?? this.clock.now();
    switch (update.status) {
      case 'sent':
        return false;
      case 'delivered':
        if (record.deliveredAt) return false;
        await this.deliveries.save(record.id, { deliveredAt: at });
        return true;
      case 'read':
        await this.deliveries.save(record.id, { readAt: record.readAt ?? at, deliveredAt: record.deliveredAt ?? at });
        return true;
      case 'failed':
        return this.applyFailure(record.id, update);
      default:
        return false;
    }
  }

  private async applyFailure(deliveryId: string, update: ChannelStatusUpdate): Promise<boolean> {
    const record = (await this.deliveries.findById(deliveryId))!;
    if (record.status !== 'sent' || record.externalId !== update.externalId) return false;
    const delivery = new Delivery({
      status: record.status,
      chain: record.chain,
      stepIndex: record.stepIndex,
      attempts: record.attempts,
      channelAttempts: record.channelAttempts,
    });
    const failedStep = delivery.current;
    const decision = delivery.reopenAfterAsyncFailure();
    const state = delivery.snapshot();
    const next = delivery.current;
    const error = `${update.errorCode ?? 'failed'}: ${update.error ?? 'provider reported delivery failure'}`.slice(0, 1000);
    await this.deliveries.insertAttempt({
      deliveryId: record.id,
      messageId: record.messageId,
      attemptNo: await this.deliveries.nextAttemptNo(record.id),
      channel: failedStep.channel,
      provider: update.provider,
      addressMasked: maskAddress(failedStep.channel, failedStep.address),
      status: 'failed',
      retryable: false,
      errorCode: update.errorCode,
      error: update.error ?? 'provider reported delivery failure',
      externalId: update.externalId,
      durationMs: null,
      occurredAt: update.occurredAt ?? this.clock.now(),
    });
    await this.deliveries.save(record.id, {
      status: state.status,
      stepIndex: state.stepIndex,
      channel: next.channel,
      address: next.address,
      channelAttempts: state.channelAttempts,
      lastError: error,
      ...(decision === 'next' ? { sentAt: null, provider: null, externalId: null } : {}),
    });
    const message = await this.messages.findById(record.messageId);
    if (!message) return true;
    if (decision === 'next') {
      if (message.status !== MessageStatus.Queued) {
        MESSAGE_FSM.assertTransition(message.status, MessageStatus.Queued);
        await this.messages.reopen(message.id);
      }
      await this.jobs.enqueue<DeliverJobPayload>(DELIVER_JOB, { messageId: message.id }, { aggregateId: message.id, branchId: message.branchId });
      this.logger.log({ messageId: message.id, deliveryId: record.id, next: next.channel }, 'Provider reported failure, falling back');
      return true;
    }
    // Резервного канала нет: пересчитать итог сообщения.
    if (message.status !== MessageStatus.Queued) {
      const statuses = (await this.deliveries.forMessage(message.id)).map((d) => d.status);
      const status = aggregateMessageStatus(statuses);
      if (status && status !== message.status) {
        MESSAGE_FSM.assertTransition(message.status, status);
        await this.messages.setFinalStatus(message.id, status, error);
      }
    }
    return true;
  }
}
