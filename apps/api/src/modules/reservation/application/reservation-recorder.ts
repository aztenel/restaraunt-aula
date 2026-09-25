import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { Permission } from '../../../shared/kernel/permissions';
import { translate } from '../../../shared/kernel/translatable';
import { BranchInfo } from '../../identity/public';
import { AdminFeed, GuestTemplate, GuestTemplateParams, Notifier } from '../../notifications/public';
import { PaymentsService } from '../../payments/public';
import { CancelDepositResolution, DepositResolution } from '../domain/deposit-policy';
import { Reservation, SlotChange, StatusChange } from '../domain/reservation';
import { depositNote, formatLocalDate, formatLocalDateTime, formatLocalTime, formatTenge } from '../domain/texts';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { VenueDetails } from '../infrastructure/venue.repository';
import { ReservationEvents } from '../public';
import { createdPayload, rescheduledPayload, statusChangedPayload } from './reservation-events';
import { ReservationLinks } from './reservation-links';
import { ReservationReminders } from './reservation-reminders';

export interface RecordContext {
  actor: Actor;
  branch: BranchInfo;
  /** Текущее место брони. */
  venue: VenueDetails;
  /** Состояние брони до действия (журнал: было / стало). */
  before?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
}

/** Причина для платёжного модуля при отмене неоплаченного платежа / возврате депозита. */
export type PaymentReason = 'reservation_cancelled' | 'reservation_expired' | 'deposit_waived' | 'banquet_released';

const STATUS_TITLES: Record<string, string> = {
  pending: 'ждёт подтверждения',
  awaiting_deposit: 'ждёт оплату депозита',
  confirmed: 'подтверждена',
  arrived: 'гости пришли',
  no_show: 'гости не пришли',
  cancelled: 'отменена',
  expired: 'снята по таймауту',
};

/**
 * Последствия создания и изменений брони — в транзакции действия: история статусов, журнал действий
 * (было / стало, исход депозита), события контракта, платёжные последствия (отмена неоплаченного платежа,
 * возврат депозита), уведомления гостю и персоналу, лента админки, напоминание.
 * Уведомления создаются записями (доставка — задачами Notifications) и бронь не блокируют.
 */
@Injectable()
export class ReservationRecorder {
  constructor(
    private readonly reservations: ReservationRepository,
    private readonly payments: PaymentsService,
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
    private readonly reminders: ReservationReminders,
    private readonly links: ReservationLinks,
    private readonly clock: Clock,
  ) {}

  /** Новая бронь (обычная или банкетная занятость). */
  async created(r: Reservation, ctx: RecordContext): Promise<void> {
    const now = this.clock.now();
    const p = r.snapshot();
    await this.reservations.appendHistory(r.id, { from: null, to: r.status, reason: null, depositOutcome: 'none', at: now }, ctx.actor);
    await this.audit.record({
      action: 'reservation.created',
      entityType: 'reservation',
      entityId: r.id,
      branchId: r.branchId,
      after: r.auditState(),
      meta: { number: p.number, kind: p.kind, source: p.source, banquetRequestId: p.banquetRequestId, ...(ctx.meta ?? {}) },
      actor: ctx.actor,
    });
    if (p.depositState === 'waived') await this.depositWaived(r, ctx.actor, 'required');
    await this.events.publish(ReservationEvents.ReservationCreated, createdPayload(r, ctx.venue, now), {
      aggregateId: r.id,
      branchId: r.branchId,
    });
    if (r.kind === 'banquet') {
      await this.pushFeed(r, `Зал ${translate(ctx.venue.name, 'ru')} занят под банкет · ${this.when(r, ctx.branch)}`);
      return;
    }
    await this.notifyGuestAbout(r, r.status, ctx);
    if (p.source === 'web') {
      await this.notifier.notifyStaff({
        audience: { branchId: r.branchId, permission: Permission.ReservationsManage, includeBranchChannels: true },
        template: 'staff.reservation_new',
        params: {
          number: p.number,
          date: formatLocalDate(p.start, ctx.branch.timezone),
          time: formatLocalTime(p.start, ctx.branch.timezone),
          guests: String(p.guests),
          venueName: translate(ctx.venue.name, 'ru'),
          adminUrl: this.links.admin(r.id),
        },
        dedupeKey: `reservation:${r.id}:staff_new`,
        related: { type: 'reservation', id: r.id },
      });
    }
    await this.feed.push({
      branchId: r.branchId,
      stream: 'reservations',
      kind: 'created',
      entityId: r.id,
      title: `Новая бронь ${p.number} · ${this.when(r, ctx.branch)} · ${p.guests} гост. · ${translate(ctx.venue.name, 'ru')}`,
      sound: p.source === 'web',
    });
    await this.reminders.schedule(r);
  }

  /** Сотрудник отказался от депозита (с причиной) — отдельная запись журнала: действие меняет деньги. */
  async depositWaived(r: Reservation, actor: Actor, previousState: string): Promise<void> {
    const p = r.snapshot();
    await this.audit.record({
      action: 'reservation.deposit_waived',
      entityType: 'reservation',
      entityId: r.id,
      branchId: r.branchId,
      before: { deposit: p.deposit?.toJSON() ?? null, depositState: previousState },
      after: { deposit: p.deposit?.toJSON() ?? null, depositState: p.depositState },
      meta: { number: p.number, reason: p.depositWaiveReason, cancelledPaymentId: p.depositPaymentId },
      actor,
    });
  }

  /** Переход статуса. resolution — что сделать с депозитом (отмена платежа, возврат). */
  async transitioned(
    r: Reservation,
    change: StatusChange,
    resolution: DepositResolution | CancelDepositResolution | null,
    ctx: RecordContext & { paymentReason?: PaymentReason },
  ): Promise<void> {
    const p = r.snapshot();
    await this.reservations.appendHistory(r.id, change, ctx.actor);
    await this.audit.record({
      action: 'reservation.status_changed',
      entityType: 'reservation',
      entityId: r.id,
      branchId: r.branchId,
      before: ctx.before ?? { ...r.auditState(), status: change.from },
      after: r.auditState(),
      meta: { number: p.number, from: change.from, to: change.to, reason: change.reason, ...(ctx.meta ?? {}) },
      actor: ctx.actor,
    });
    if (change.depositOutcome !== 'none') {
      const decision = resolution && 'policyOutcome' in resolution ? resolution : null;
      await this.audit.record({
        action: change.depositOutcome === 'refunded' ? 'reservation.deposit_refund_requested' : 'reservation.deposit_retained',
        entityType: 'reservation',
        entityId: r.id,
        branchId: r.branchId,
        before: { depositState: ctx.before?.depositState ?? 'paid', deposit: p.deposit?.toJSON() ?? null },
        after: { depositState: p.depositState, depositOutcome: change.depositOutcome, deposit: p.deposit?.toJSON() ?? null },
        meta: {
          number: p.number,
          status: change.to,
          paymentId: p.depositPaidPaymentId,
          policyOutcome: decision?.policyOutcome ?? change.depositOutcome,
          overriddenByStaff: decision?.overridden ?? false,
        },
        actor: ctx.actor,
      });
    }
    await this.applyPaymentEffects(r, resolution, ctx.paymentReason ?? 'reservation_cancelled');
    await this.events.publish(ReservationEvents.ReservationStatusChanged, statusChangedPayload(r, change, ctx.venue), {
      aggregateId: r.id,
      branchId: r.branchId,
    });
    await this.pushFeed(r, `Бронь ${p.number}: ${STATUS_TITLES[change.to] ?? change.to}`);
    if (r.kind === 'banquet') return;
    await this.notifyGuestAbout(r, change.to, ctx);
    if (change.to === 'cancelled' && p.cancelledBy === 'guest') {
      await this.notifier.notifyStaff({
        audience: { branchId: r.branchId, permission: Permission.ReservationsManage, includeBranchChannels: true },
        template: 'staff.reservation_cancelled',
        params: {
          number: p.number,
          date: formatLocalDate(p.start, ctx.branch.timezone),
          time: formatLocalTime(p.start, ctx.branch.timezone),
        },
        dedupeKey: `reservation:${r.id}:staff_cancelled`,
        related: { type: 'reservation', id: r.id },
      });
    }
    if (change.to === 'confirmed') await this.reminders.schedule(r);
  }

  /** Перенос: другое место, время, число гостей (статус не меняется). */
  async rescheduled(
    r: Reservation,
    change: SlotChange,
    ctx: { actor: Actor; branch: BranchInfo; venues: { before: VenueDetails; after: VenueDetails }; before: Record<string, unknown>; reason: string | null },
  ): Promise<void> {
    const now = this.clock.now();
    const p = r.snapshot();
    await this.audit.record({
      action: 'reservation.rescheduled',
      entityType: 'reservation',
      entityId: r.id,
      branchId: r.branchId,
      before: ctx.before,
      after: r.auditState(),
      meta: { number: p.number, reason: ctx.reason, kind: p.kind },
      actor: ctx.actor,
    });
    await this.events.publish(
      ReservationEvents.ReservationRescheduled,
      rescheduledPayload(r, change, ctx.venues, ctx.reason, now),
      { aggregateId: r.id, branchId: r.branchId },
    );
    await this.pushFeed(r, `Бронь ${p.number} перенесена: ${this.when(r, ctx.branch)}`);
    if (r.kind === 'banquet') return;
    const recordCtx: RecordContext = { actor: ctx.actor, branch: ctx.branch, venue: ctx.venues.after };
    if (r.status === 'confirmed' || r.status === 'pending') await this.notifyGuestAbout(r, r.status, recordCtx);
    await this.reminders.schedule(r);
  }

  private async applyPaymentEffects(r: Reservation, resolution: DepositResolution | null, reason: PaymentReason): Promise<void> {
    if (!resolution) return;
    const p = r.snapshot();
    if (resolution.action === 'cancel_payment' && p.depositPaymentId) {
      await this.payments.cancelPayment(p.depositPaymentId, reason);
    }
    if (resolution.action === 'refund' && p.depositPaidPaymentId) {
      await this.payments.requestRefund({
        paymentId: p.depositPaidPaymentId,
        reason: `${reason}: ${p.number}`,
        idempotencyKey: `reservation:${r.id}:deposit_refund`,
      });
    }
  }

  private when(r: Reservation, branch: BranchInfo): string {
    return formatLocalDateTime(r.start, branch.timezone);
  }

  private async pushFeed(r: Reservation, title: string): Promise<void> {
    await this.feed.push({ branchId: r.branchId, stream: 'reservations', kind: 'updated', entityId: r.id, title, sound: false });
  }

  /** Гостевое уведомление о статусе (шаблон на языке брони). */
  private async notifyGuestAbout(r: Reservation, status: string, ctx: RecordContext): Promise<void> {
    const p = r.snapshot();
    const tz = ctx.branch.timezone;
    const locale = p.locale;
    const date = formatLocalDate(p.start, tz);
    const time = formatLocalTime(p.start, tz);
    const branchName = translate(ctx.branch.name, locale);
    const manageUrl = this.links.manage(p.publicToken, locale);
    const startKey = p.start.toISOString();
    switch (status) {
      case 'pending':
        return this.guest(r, 'reservation.pending', { number: p.number, branchName, date, time, guests: String(p.guests), manageUrl }, `pending:${startKey}`);
      case 'awaiting_deposit':
        return this.guest(
          r,
          'reservation.awaiting_deposit',
          {
            number: p.number,
            branchName,
            date,
            time,
            deposit: p.deposit ? formatTenge(p.deposit) : '',
            paymentUrl: this.links.payment(p.publicToken, locale),
            holdUntil: p.holdExpiresAt ? formatLocalDateTime(p.holdExpiresAt, tz) : '',
          },
          'awaiting_deposit',
        );
      case 'confirmed':
        return this.guest(
          r,
          'reservation.confirmed',
          {
            number: p.number,
            branchName,
            branchAddress: translate(ctx.branch.address, locale),
            venueName: translate(ctx.venue.name, locale),
            date,
            time,
            guests: String(p.guests),
            manageUrl,
          },
          `confirmed:${startKey}:${p.venueId}`,
        );
      case 'cancelled':
        return this.guest(r, 'reservation.cancelled', { number: p.number, date, time, depositNote: depositNote(p.depositOutcome, locale) }, 'cancelled');
      case 'expired':
        return this.guest(r, 'reservation.expired', { number: p.number, date, time }, 'expired');
      default:
        return;
    }
  }

  private async guest<T extends GuestTemplate>(r: Reservation, template: T, params: GuestTemplateParams[T], dedupe: string): Promise<void> {
    const c = r.customer;
    if (!c.phone && !c.email) return;
    await this.notifier.notifyGuest({
      recipient: { phone: c.phone, email: c.email, name: c.name },
      template,
      params,
      locale: r.locale,
      dedupeKey: `reservation:${r.id}:${dedupe}`,
      related: { type: 'reservation', id: r.id },
    });
  }
}
