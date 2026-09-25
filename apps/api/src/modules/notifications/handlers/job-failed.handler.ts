import { Injectable } from '@nestjs/common';
import { OnEvent } from '../../../shared/infrastructure/events/decorators';
import { JobFailedPayload, PLATFORM_JOB_FAILED_EVENT } from '../../../shared/infrastructure/events/handler-executor';
import { EventEnvelope } from '../../../shared/infrastructure/events/types';
import { AlertJobFailure } from '../application/alert-job-failure.action';

/** Очередь неудач пополнилась -> оповещение администратора системы и системная лента админки. */
@Injectable()
export class NotificationsJobFailedHandler {
  constructor(private readonly alert: AlertJobFailure) {}

  @OnEvent(PLATFORM_JOB_FAILED_EVENT)
  async onJobFailed(event: EventEnvelope<JobFailedPayload>): Promise<void> {
    await this.alert.execute(event.payload);
  }
}
