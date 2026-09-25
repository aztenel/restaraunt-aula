import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { formatLocalDate, formatLocalTime } from '../domain/texts';
import { reminderDue } from '../domain/reminder';
import { HOLD_STATUSES } from '../domain/reservation-status';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { Notifier } from '../../notifications/public';
import { translate } from '../../../shared/kernel/translatable';
import { ReservationAccess } from './reservation-access';
import { ReservationLinks } from './reservation-links';
import { ReservationRecorder } from './reservation-recorder';
import { ReminderJobPayload } from './reservation-reminders';

/**
 * Снятие неподтверждённых / неоплаченных броней по истечении удержания (holdMinutes) -> expired:
 * неоплаченный платёж отменяется, оплаченный депозит (не подтвердили вовремя) возвращается,
 * гостю — уведомление 'reservation.expired'. Каждая бронь — своя транзакция.
 */
@Injectable()
export class ExpireReservationHolds {
  private readonly logger = new Logger(ExpireReservationHolds.name);

  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const ids = await this.reservations.expiredHoldIds(this.clock.now());
    let expired = 0;
    for (const id of ids) {
      try {
        const done = await this.database.transaction(async () => {
          const now = this.clock.now();
          const r = await this.access.lock(id);
          if (!HOLD_STATUSES.includes(r.status) || !r.holdExpiresAt || r.holdExpiresAt.getTime() > now.getTime()) return false;
          const before = r.auditState();
          const { change, resolution } = r.expire(now);
          await this.reservations.update(r);
          const ctx = await this.access.context(r);
          await this.recorder.transitioned(r, change, resolution, {
            ...ctx,
            actor: Actor.system('reservation.expire_holds'),
            before,
            paymentReason: 'reservation_expired',
          });
          return true;
        });
        if (done) expired++;
      } catch (err) {
        this.logger.error({ err, reservationId: id }, 'Failed to expire reservation hold');
      }
    }
    return expired;
  }
}

/** Напоминание гостю (задача с runAt): только если бронь всё ещё подтверждена и не перенесена. */
@Injectable()
export class SendReservationReminder {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly notifier: Notifier,
    private readonly links: ReservationLinks,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(job: ReminderJobPayload): Promise<'sent' | 'skipped'> {
    return this.database.transaction(async () => {
      const r = await this.reservations.findById(job.reservationId, { forUpdate: true });
      if (!r) return 'skipped';
      const now = this.clock.now();
      if (!reminderDue({ status: r.status, start: r.start, scheduledStart: job.start, reminderSentAt: r.reminderSentAt, now })) return 'skipped';
      if (!r.customer.phone && !r.customer.email) return 'skipped';
      const { branch } = await this.access.context(r);
      await this.notifier.notifyGuest({
        recipient: { phone: r.customer.phone, email: r.customer.email, name: r.customer.name },
        template: 'reservation.reminder',
        params: {
          number: r.number,
          branchName: translate(branch.name, r.locale),
          branchAddress: translate(branch.address, r.locale),
          date: formatLocalDate(r.start, branch.timezone),
          time: formatLocalTime(r.start, branch.timezone),
          manageUrl: this.links.manage(r.publicToken, r.locale),
        },
        locale: r.locale,
        dedupeKey: `reservation:${r.id}:reminder:${r.start.toISOString()}`,
        related: { type: 'reservation', id: r.id },
      });
      r.markReminderSent(now);
      await this.reservations.update(r);
      return 'sent';
    });
  }
}

/** Гость обезличен (Customers.CustomerAnonymized): стираем контакты в снимках его броней. */
@Injectable()
export class AnonymizeReservationGuest {
  constructor(private readonly reservations: ReservationRepository) {}

  async execute(customerId: string): Promise<number> {
    return this.reservations.anonymizeCustomer(customerId);
  }
}
