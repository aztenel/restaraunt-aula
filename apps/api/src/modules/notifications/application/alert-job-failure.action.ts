import { Injectable } from '@nestjs/common';
import { EVENT_DELIVERY_TOPIC } from '../../../shared/infrastructure/events/types';
import { JobFailedPayload } from '../../../shared/infrastructure/events/handler-executor';
import { Permission } from '../../../shared/kernel/permissions';
import { AdminFeed, Notifier } from '../public';

/** Задачи самого модуля уведомлений: оповещать о них теми же каналами бессмысленно (и грозит лавиной). */
const OWN_JOB_PREFIX = 'notifications.';

/**
 * Задача или обработчик события исчерпали повторы (очередь неудач): оповещение администраторам
 * (право system.jobs) по WhatsApp/Telegram и событие в системной ленте админки.
 */
@Injectable()
export class AlertJobFailure {
  constructor(
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
  ) {}

  async execute(failure: JobFailedPayload): Promise<void> {
    const isEventHandler = failure.topic === EVENT_DELIVERY_TOPIC;
    const title = isEventHandler
      ? `Сбой обработчика события: ${failure.handler ?? 'неизвестный обработчик'}`
      : `Задача в очереди неудач: ${failure.topic}`;
    const details = `${failure.error} (попыток: ${failure.attempts}, запись очереди неудач ${failure.failedJobId})`.slice(0, 600);
    if (!failure.topic.startsWith(OWN_JOB_PREFIX)) {
      await this.notifier.notifyStaff({
        audience: { branchId: null, permission: Permission.SystemJobs },
        template: 'staff.system_alert',
        params: { title, details },
        dedupeKey: `job_failed:${failure.failedJobId}`,
        related: { type: 'failed_job', id: failure.failedJobId },
      });
    }
    await this.feed.push({
      branchId: null,
      stream: 'system',
      kind: 'created',
      entityId: failure.failedJobId,
      entityType: 'failed_job',
      title,
      sound: true,
    });
  }
}
