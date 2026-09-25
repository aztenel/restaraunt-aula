import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { normalizeFreeText } from '../domain/contact';
import { DepositDecision } from '../domain/deposit-policy';
import { Reservation } from '../domain/reservation';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { ReservationAccess } from './reservation-access';
import { ReservationRecorder } from './reservation-recorder';

/**
 * Действия персонала над статусом брони (конечный автомат в домене; недопустимый переход —
 * 409 reservation.invalid_transition). Каждое действие — транзакция: блокировка строки брони,
 * переход, запись, журнал (было / стало), событие, уведомления.
 */

/** Подтверждение: pending -> confirmed. Неоплаченный депозит — только с отказом от него (причина). */
@Injectable()
export class ConfirmReservation {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: { waiveDepositReason?: string | null } = {}): Promise<Reservation> {
    await this.access.forStaff(actor, id, Permission.ReservationsManage);
    return this.database.transaction(async () => {
      const r = await this.access.lock(id);
      const before = r.auditState();
      const { change, resolution } = r.confirm(this.clock.now(), { waiveDepositReason: input.waiveDepositReason });
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, { ...ctx, actor, before, paymentReason: 'deposit_waived' });
      if (resolution.nextState === 'waived') await this.recorder.depositWaived(r, actor, String(before.depositState));
      return r;
    });
  }
}

/**
 * Отмена сотрудником (причина обязательна). Депозит — по правилу отмены места или по решению
 * сотрудника (refund / retain): решение имеет приоритет, расхождение с правилом отмечается в журнале.
 */
@Injectable()
export class CancelReservation {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string, input: { reason: string; depositDecision?: DepositDecision | null }): Promise<Reservation> {
    const reason = normalizeFreeText(input.reason, 'reason', 500);
    if (!reason) throw new ValidationError('reservation.cancel_reason_required', 'Cancellation reason is required');
    await this.access.forStaff(actor, id, Permission.ReservationsManage);
    return this.database.transaction(async () => {
      const r = await this.access.lock(id);
      const before = r.auditState();
      const { change, resolution } = r.cancel({ now: this.clock.now(), by: 'staff', reason, staffDecision: input.depositDecision ?? null });
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, {
        ...ctx,
        actor,
        before,
        paymentReason: 'reservation_cancelled',
        meta: { depositDecision: input.depositDecision ?? null, policyOutcome: resolution.policyOutcome, overridden: resolution.overridden },
      });
      return r;
    });
  }
}

/** «Пришли» — не раньше чем за 3 часа до начала; депозит засчитывается в счёт. */
@Injectable()
export class MarkReservationArrived {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<Reservation> {
    await this.access.forStaff(actor, id, Permission.ReservationsManage);
    return this.database.transaction(async () => {
      const r = await this.access.lock(id);
      const before = r.auditState();
      const { change, resolution } = r.markArrived(this.clock.now());
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, { ...ctx, actor, before });
      return r;
    });
  }
}

/** «Не пришли» — только после начала брони; депозит удерживается. */
@Injectable()
export class MarkReservationNoShow {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<Reservation> {
    await this.access.forStaff(actor, id, Permission.ReservationsManage);
    return this.database.transaction(async () => {
      const r = await this.access.lock(id);
      const before = r.auditState();
      const { change, resolution } = r.markNoShow(this.clock.now());
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, { ...ctx, actor, before });
      return r;
    });
  }
}
