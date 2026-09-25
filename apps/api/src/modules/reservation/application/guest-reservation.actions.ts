import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError } from '../../../shared/kernel/errors';
import { PaymentsService, PaymentStatus } from '../../payments/public';
import { normalizeFreeText } from '../domain/contact';
import { Reservation } from '../domain/reservation';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { DepositPayments } from './deposit-payments';
import { ReservationAccess } from './reservation-access';
import { ReservationRecorder } from './reservation-recorder';

/**
 * Самообслуживание гостя по публичному токену брони: отмена и повторная оплата депозита.
 * Отмена до дедлайна (cancellationDeadlineHours из правил брони) — депозит возвращается,
 * позже — удерживается (depositOutcome в ответе и в событии).
 */
@Injectable()
export class CancelReservationByGuest {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly recorder: ReservationRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(token: string, input: { reason?: string | null } = {}): Promise<Reservation> {
    const found = await this.access.byToken(token);
    const reason = normalizeFreeText(input.reason, 'reason', 500);
    return this.database.transaction(async () => {
      const r = await this.access.lock(found.id);
      const before = r.auditState();
      const { change, resolution } = r.cancel({ now: this.clock.now(), by: 'guest', reason });
      await this.reservations.update(r);
      const ctx = await this.access.context(r);
      await this.recorder.transitioned(r, change, resolution, { ...ctx, actor: Actor.guest(), before, paymentReason: 'reservation_cancelled' });
      return r;
    });
  }
}

/** Платёж ещё можно оплатить — новую попытку не создаём. */
const PAYABLE: readonly PaymentStatus[] = ['created', 'pending'];

/**
 * Повторная оплата депозита (предыдущая попытка отклонена или отменена). Пока текущий платёж ждёт оплаты,
 * возвращается он же; новая попытка — новый платёж со своим ключом идемпотентности.
 */
@Injectable()
export class RetryDepositPayment {
  constructor(
    private readonly access: ReservationAccess,
    private readonly reservations: ReservationRepository,
    private readonly payments: PaymentsService,
    private readonly deposits: DepositPayments,
    private readonly audit: AuditLog,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(token: string): Promise<Reservation> {
    const found = await this.access.byToken(token);
    return this.database.transaction(async () => {
      const r = await this.access.lock(found.id);
      if (!r.guestCanPay(this.clock.now())) {
        throw new ConflictError('reservation.payment_not_expected', 'Reservation is not awaiting a deposit payment', { status: r.status });
      }
      if (r.depositPaymentId) {
        const current = await this.payments.getPayment(r.depositPaymentId);
        if (PAYABLE.includes(current.status)) return r;
      }
      const previousPaymentId = r.depositPaymentId;
      const payment = await this.deposits.createFor(r);
      await this.reservations.update(r);
      await this.audit.record({
        action: 'reservation.deposit_payment_created',
        entityType: 'reservation',
        entityId: r.id,
        branchId: r.branchId,
        before: { depositPaymentId: previousPaymentId },
        after: { depositPaymentId: payment.id, amount: payment.amount.toJSON(), attempt: r.snapshot().depositAttempts },
        meta: { number: r.number },
        actor: Actor.guest(),
      });
      return r;
    });
  }
}
