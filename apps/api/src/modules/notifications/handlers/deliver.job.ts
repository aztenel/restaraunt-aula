import { Injectable } from '@nestjs/common';
import { JobHandler } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { DELIVER_JOB_ATTEMPTS, DeliverMessage } from '../application/deliver-message.action';
import { DELIVER_JOB, DeliverJobPayload } from '../application/queue-notification.action';

/**
 * Задача доставки уведомления. Временные сбои каналов повторяются с экспоненциальной задержкой
 * (5 с, 10 с, 20 с ...), после трёх неудач канала — резервный канал. Лимит запусков покрывает
 * всю цепочку каналов, поэтому задача не уходит в очередь неудач при обычных сбоях провайдеров.
 */
@Injectable()
export class NotificationsDeliveryJob {
  constructor(private readonly deliver: DeliverMessage) {}

  @JobHandler(DELIVER_JOB, { attempts: DELIVER_JOB_ATTEMPTS, backoffMs: 5_000, maxBackoffMs: 10 * 60_000 })
  async handle(job: JobEnvelope<DeliverJobPayload>): Promise<void> {
    await this.deliver.execute(job.payload.messageId);
  }
}
