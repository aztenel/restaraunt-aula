import { Injectable, Logger } from '@nestjs/common';
import { JobHandler, Scheduled } from '../../../shared/infrastructure/events/decorators';
import { JobEnvelope } from '../../../shared/infrastructure/events/types';
import { ExpireReservationHolds, SendReservationReminder } from '../application/maintenance.actions';
import { ReminderJobPayload, ReservationJobs } from '../application/reservation-reminders';

/** Фоновые задачи модуля: напоминание гостю (задача с runAt, поставленная при подтверждении брони). */
@Injectable()
export class ReservationJobHandlers {
  constructor(private readonly reminder: SendReservationReminder) {}

  @JobHandler(ReservationJobs.SendReminder, { attempts: 5, backoffMs: 30_000, maxBackoffMs: 10 * 60_000 })
  async sendReminder(job: JobEnvelope<ReminderJobPayload>): Promise<void> {
    await this.reminder.execute(job.payload);
  }
}

/** Периодические задачи модуля (часовой пояс Asia/Almaty). */
@Injectable()
export class ReservationSchedules {
  private readonly logger = new Logger(ReservationSchedules.name);

  constructor(private readonly expireHolds: ExpireReservationHolds) {}

  /** Раз в минуту: неподтверждённые / неоплаченные брони с истёкшим удержанием -> expired. */
  @Scheduled('reservation.expire_holds', { everyMs: 60_000 })
  async expire(): Promise<void> {
    const expired = await this.expireHolds.execute();
    if (expired > 0) this.logger.log({ expired }, 'Reservation holds expired');
  }
}
