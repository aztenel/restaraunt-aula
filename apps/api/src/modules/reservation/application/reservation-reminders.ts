import { Injectable } from '@nestjs/common';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { Reservation } from '../domain/reservation';
import { reminderAt } from '../domain/reminder';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';

export const ReservationJobs = {
  /** Напоминание гостю за reminderHoursBefore часов до начала (только если бронь ещё подтверждена). */
  SendReminder: 'reservation.send_reminder',
} as const;

export interface ReminderJobPayload {
  reservationId: string;
  /** Начало брони на момент постановки: после переноса старая задача не срабатывает. */
  start: string;
}

/** Постановка напоминания при подтверждении брони (задача с runAt, внутри транзакции подтверждения). */
@Injectable()
export class ReservationReminders {
  constructor(
    private readonly settings: ReservationSettingsRepository,
    private readonly jobs: JobQueue,
    private readonly clock: Clock,
  ) {}

  async schedule(r: Reservation): Promise<void> {
    if (r.kind !== 'regular' || r.status !== 'confirmed') return;
    const { reminderHoursBefore } = await this.settings.get(r.branchId);
    const runAt = reminderAt(r.start, reminderHoursBefore, this.clock.now());
    if (!runAt) return;
    await this.jobs.enqueue<ReminderJobPayload>(
      ReservationJobs.SendReminder,
      { reservationId: r.id, start: r.start.toISOString() },
      { runAt, aggregateId: r.id, branchId: r.branchId },
    );
  }
}
