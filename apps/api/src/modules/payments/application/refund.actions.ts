import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus, JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { Notifier } from '../../notifications/public';
import { formatTenge } from '../domain/money-format';
import { isReferenceFullyRefunded, Payment } from '../domain/payment';
import { Refund, refundModeFor, reservedRefundTotal } from '../domain/refund';
import { PaymentRepository } from '../infrastructure/payment.repository';
import { RefundRepository } from '../infrastructure/refund.repository';
import { PaymentsEvents, RefundEventPayload, RefundView } from '../public';
import { CreditCertificate } from './certificates/certificate-ledger.actions';
import { PaymentJobs } from './create-payment.action';
import { paymentAuditState } from './payment-events';
import { PaymentGatewayRegistry, toGatewayPayment } from './payment-gateway.registry';
import { errorMessage, isRetryable } from './payment-provider.actions';

export const REFUND_MAX_ATTEMPTS = 6;
/** Аренда возврата на время обращения к провайдеру. */
const REFUND_LEASE_MS = 5 * 60_000;

export interface RefundJobPayload {
  refundId: string;
}

export interface RequestRefundInput {
  paymentId: string;
  amount?: Money;
  reason: string;
  idempotencyKey: string;
}

function refundAuditState(refund: Refund): Record<string, unknown> {
  const s = refund.snapshot();
  return { status: s.status, amount: s.amount.toJSON(), mode: s.mode, reason: s.reason, externalRefundId: s.externalRefundId };
}

async function refundPayload(
  payments: PaymentRepository,
  refund: Refund,
  payment: Payment,
  now: Date,
): Promise<RefundEventPayload> {
  const siblings = await payments.listForReference(payment.purpose, payment.referenceId);
  // Текущий платёж берём из памяти: в нём уже применён этот возврат.
  const statuses = siblings.map((p) => (p.id === payment.id ? payment : p));
  return {
    refundId: refund.id,
    paymentId: payment.id,
    purpose: payment.purpose,
    referenceId: payment.referenceId,
    branchId: payment.branchId,
    amount: refund.amount.toJSON(),
    paymentFullyRefunded: payment.isFullyRefunded(),
    referenceFullyRefunded: isReferenceFullyRefunded(statuses),
    reason: refund.reason,
    occurredAt: now.toISOString(),
  };
}

/**
 * Возврат прошёл: статус возврата, возвращённая сумма и статус платежа, для сертификата — движение
 * по сертификату, событие RefundSucceeded (paymentFullyRefunded, referenceFullyRefunded), аудит.
 */
@Injectable()
export class CompleteRefund {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly creditCertificate: CreditCertificate,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(
    refundId: string,
    details: { externalRefundId?: string | null; comment?: string | null; completedBy?: string | null; actor?: Actor },
  ): Promise<'applied' | 'ignored'> {
    return this.database.transaction(async () => {
      const now = this.clock.now();
      const refund = await this.refunds.findById(refundId);
      if (!refund) throw new NotFoundError('refund', refundId);
      const payment = await this.payments.findById(refund.paymentId, { forUpdate: true });
      if (!payment) throw new NotFoundError('payment', refund.paymentId);
      const locked = (await this.refunds.findById(refundId, { forUpdate: true }))!;
      if (!locked.isPending()) return 'ignored';
      const before = paymentAuditState(payment);
      const certificateId = payment.snapshot().certificateId;
      if (locked.mode === 'certificate' && certificateId) {
        await this.creditCertificate.execute({
          certificateId,
          amount: locked.amount,
          paymentId: payment.id,
          refundId: locked.id,
          branchId: payment.branchId,
          comment: locked.reason,
        });
      }
      locked.succeed({ now, externalRefundId: details.externalRefundId, comment: details.comment, completedBy: details.completedBy });
      payment.applyRefund(locked.amount);
      await this.refunds.save(locked);
      await this.payments.save(payment);
      await this.audit.record({
        action: 'refund.succeeded',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before,
        after: paymentAuditState(payment),
        meta: { refundId: locked.id, amount: locked.amount.toJSON(), mode: locked.mode, comment: details.comment ?? null },
        actor: details.actor,
      });
      await this.events.publish(PaymentsEvents.RefundSucceeded, await refundPayload(this.payments, locked, payment, now), {
        aggregateId: payment.id,
        branchId: payment.branchId,
      });
      return 'applied';
    });
  }
}

/** Окончательная неудача возврата: событие RefundFailed и оповещение персоналу. */
@Injectable()
export class FailRefund {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly notifier: Notifier,
    private readonly clock: Clock,
  ) {}

  async execute(refundId: string, input: { reason: string; completedBy?: string | null; notifyStaff: boolean; actor?: Actor }): Promise<void> {
    await this.database.transaction(async () => {
      const now = this.clock.now();
      const refund = await this.refunds.findById(refundId);
      if (!refund) throw new NotFoundError('refund', refundId);
      const payment = await this.payments.findById(refund.paymentId, { forUpdate: true });
      if (!payment) throw new NotFoundError('payment', refund.paymentId);
      const locked = (await this.refunds.findById(refundId, { forUpdate: true }))!;
      if (!locked.isPending()) return;
      const before = refundAuditState(locked);
      locked.fail({ now, reason: input.reason, completedBy: input.completedBy });
      await this.refunds.save(locked);
      await this.audit.record({
        action: 'refund.failed',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before,
        after: refundAuditState(locked),
        meta: { refundId: locked.id, reason: input.reason },
        actor: input.actor,
      });
      await this.events.publish(PaymentsEvents.RefundFailed, await refundPayload(this.payments, locked, payment, now), {
        aggregateId: payment.id,
        branchId: payment.branchId,
      });
      if (input.notifyStaff) {
        await this.notifier.notifyStaff({
          audience: { branchId: payment.branchId, permission: Permission.PaymentsRefund },
          template: 'staff.refund_failed',
          params: {
            reference: `${payment.purpose} ${payment.referenceId} (платёж ${payment.id})`,
            amount: formatTenge(locked.amount),
            error: input.reason.slice(0, 300),
          },
          dedupeKey: `refund:${locked.id}:failed`,
          related: { type: 'payment', id: payment.id },
        });
      }
    });
  }
}

/**
 * Запрос возврата (контракт requestRefund и админка). Сумма по умолчанию — весь невозвращённый остаток;
 * вместе с ожидающими и прошедшими возвратами не превышает сумму платежа (под блокировкой платежа).
 * Идемпотентно по ключу. Исполнение зависит от способа оплаты:
 * online — задача payments.refund к провайдеру; сертификат — сразу обратно на сертификат;
 * при получении / перевод — ждёт ручного подтверждения финансиста.
 */
@Injectable()
export class RequestRefund {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly completeRefund: CompleteRefund,
    private readonly database: Database,
    private readonly jobs: JobQueue,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: RequestRefundInput, actor?: Actor): Promise<RefundView> {
    const existing = await this.refunds.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return this.same(existing, input);

    return this.database.transaction(async () => {
      const now = this.clock.now();
      const payment = await this.payments.findById(input.paymentId, { forUpdate: true });
      if (!payment) throw new NotFoundError('payment', input.paymentId);
      actor?.assertCan(Permission.PaymentsRefund, payment.branchId);
      const reserved = reservedRefundTotal(await this.refunds.listForPayment(payment.id), payment.amount.currency);
      const amount = payment.planRefund(input.amount ?? null, reserved);
      const refund = Refund.request(
        {
          id: newId(),
          paymentId: payment.id,
          amount,
          mode: refundModeFor(payment.method),
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          requestedBy: actor?.userId ?? null,
        },
        now,
      );
      if (!(await this.refunds.insert(refund))) {
        const raced = await this.refunds.findByIdempotencyKey(input.idempotencyKey);
        if (raced) return this.same(raced, input);
        throw new ConflictError('refund.idempotency_conflict', 'Refund with this idempotency key is being created');
      }
      await this.audit.record({
        action: 'refund.requested',
        entityType: 'payment',
        entityId: payment.id,
        branchId: payment.branchId,
        before: paymentAuditState(payment),
        after: refundAuditState(refund),
        meta: { refundId: refund.id },
        actor,
      });
      if (refund.mode === 'gateway') {
        await this.jobs.enqueue(PaymentJobs.Refund, { refundId: refund.id } satisfies RefundJobPayload, {
          aggregateId: payment.id,
          branchId: payment.branchId,
        });
      } else if (refund.mode === 'certificate') {
        await this.completeRefund.execute(refund.id, {});
      }
      return (await this.refunds.findById(refund.id))!.toView();
    });
  }

  private same(existing: Refund, input: RequestRefundInput): RefundView {
    if (existing.paymentId !== input.paymentId) {
      throw new ConflictError('refund.idempotency_key_reused', 'Idempotency key was used for another refund', { refundId: existing.id });
    }
    return existing.toView();
  }
}

/**
 * Задача payments.refund: возврат через провайдера. Повторы с экспоненциальной задержкой; после
 * REFUND_MAX_ATTEMPTS неудач (или неповторяемой ошибки) — RefundFailed и оповещение персоналу.
 * Аренда (claimed_at) не даёт двум воркерам вернуть деньги дважды.
 */
@Injectable()
export class ProcessRefund {
  private readonly logger = new Logger(ProcessRefund.name);

  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly registry: PaymentGatewayRegistry,
    private readonly completeRefund: CompleteRefund,
    private readonly failRefund: FailRefund,
    private readonly clock: Clock,
  ) {}

  async execute(input: RefundJobPayload): Promise<void> {
    const attempt = await this.refunds.claim(input.refundId, this.clock.now(), REFUND_LEASE_MS);
    if (attempt === null) return;
    const refund = await this.refunds.findById(input.refundId);
    const payment = refund ? await this.payments.findById(refund.paymentId) : null;
    if (!refund || !payment) return;
    try {
      const result = await this.registry.get(payment.provider).refund(toGatewayPayment(payment), refund.amount, refund.id);
      await this.completeRefund.execute(refund.id, { externalRefundId: result.externalRefundId });
    } catch (error) {
      if (isRetryable(error) && attempt < REFUND_MAX_ATTEMPTS) {
        this.logger.warn({ refundId: refund.id, attempt, err: errorMessage(error) }, 'Refund failed, will retry');
        await this.refunds.release(refund.id);
        throw error;
      }
      this.logger.error({ refundId: refund.id, attempt, err: errorMessage(error) }, 'Refund failed permanently');
      await this.failRefund.execute(refund.id, { reason: errorMessage(error), notifyStaff: true });
    }
  }
}

/**
 * Ручное подтверждение возврата финансистом (наличные при получении, банковский перевод):
 * деньги вернули вне системы — фиксируем факт.
 */
@Injectable()
export class ConfirmManualRefund {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly completeRefund: CompleteRefund,
  ) {}

  async execute(actor: Actor, refundId: string, comment: string | null): Promise<RefundView> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundError('refund', refundId);
    const payment = await this.payments.findById(refund.paymentId);
    if (!payment) throw new NotFoundError('payment', refund.paymentId);
    actor.assertCan(Permission.PaymentsManual, payment.branchId);
    if (refund.mode !== 'manual') throw new ConflictError('refund.not_manual', 'Only manual refunds are confirmed by staff');
    if (!refund.isPending()) throw new ConflictError('refund.not_pending', 'Refund is already completed', { status: refund.status });
    await this.completeRefund.execute(refundId, { comment, completedBy: actor.userId, actor });
    return (await this.refunds.findById(refundId))!.toView();
  }
}

/** Отклонить ручной возврат (например, гость отказался): освобождает сумму для нового возврата. */
@Injectable()
export class RejectManualRefund {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly refunds: RefundRepository,
    private readonly failRefund: FailRefund,
  ) {}

  async execute(actor: Actor, refundId: string, reason: string): Promise<RefundView> {
    const refund = await this.refunds.findById(refundId);
    if (!refund) throw new NotFoundError('refund', refundId);
    const payment = await this.payments.findById(refund.paymentId);
    if (!payment) throw new NotFoundError('payment', refund.paymentId);
    actor.assertCan(Permission.PaymentsManual, payment.branchId);
    if (refund.mode !== 'manual') throw new ConflictError('refund.not_manual', 'Only manual refunds are rejected by staff');
    if (!refund.isPending()) throw new ConflictError('refund.not_pending', 'Refund is already completed', { status: refund.status });
    await this.failRefund.execute(refundId, { reason, completedBy: actor.userId, notifyStaff: false, actor });
    return (await this.refunds.findById(refundId))!.toView();
  }
}
