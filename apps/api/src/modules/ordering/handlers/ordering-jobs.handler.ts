import { Injectable } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { AUTO_CANCEL_SCHEDULE, AutoCancelUnpaidOrders } from '../application/auto-cancel-unpaid-orders.action';
import { CancelCourierClaim, CreateCourierClaim, PollCourierDispatch } from '../application/courier-dispatch.actions';
import { CourierJobPayload, CourierJobs } from '../application/courier-requests';
import { DISPATCH_CREATE_MAX_ATTEMPTS } from '../domain/courier-dispatch';

/** Фоновые задачи Ordering: все обращения к службе курьеров — только отсюда; автоотмена неоплаченных. */
@Injectable()
export class OrderingJobsHandler {
  constructor(
    private readonly createClaim: CreateCourierClaim,
    private readonly pollDispatch: PollCourierDispatch,
    private readonly cancelClaim: CancelCourierClaim,
    private readonly autoCancel: AutoCancelUnpaidOrders,
  ) {}

  @JobHandler(CourierJobs.Create, { attempts: DISPATCH_CREATE_MAX_ATTEMPTS, backoffMs: 10_000, maxBackoffMs: 5 * 60_000 })
  async onCreateClaim(job: JobEnvelope<CourierJobPayload>): Promise<void> {
    await this.createClaim.execute(job.payload);
  }

  @JobHandler(CourierJobs.Poll, { attempts: 5, backoffMs: 30_000, maxBackoffMs: 5 * 60_000 })
  async onPollDispatch(job: JobEnvelope<CourierJobPayload>): Promise<void> {
    await this.pollDispatch.execute(job.payload);
  }

  @JobHandler(CourierJobs.Cancel, { attempts: 8, backoffMs: 10_000, maxBackoffMs: 10 * 60_000 })
  async onCancelClaim(job: JobEnvelope<CourierJobPayload>): Promise<void> {
    await this.cancelClaim.execute(job.payload);
  }

  /** Раз в минуту: отмена заказов, не оплаченных за awaitingPaymentTimeoutMinutes филиала. */
  @Scheduled(AUTO_CANCEL_SCHEDULE, { everyMs: 60_000 })
  async onAutoCancelTick(): Promise<void> {
    await this.autoCancel.execute();
  }
}
