import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { PaymentMethod, RefundStatus, RefundView } from '../public';

/** Возврат: pending -> succeeded | failed. Завершённый возврат не меняется. */
export const RefundFsm = new StateMachine<RefundStatus>('refund', {
  pending: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
});

/**
 * Как исполняется возврат:
 * - gateway — через провайдера (задача в очереди с повторами);
 * - certificate — сумма возвращается на подарочный сертификат (задачей, движением в журнале сертификата);
 * - manual — наличные при получении или банковский перевод: автоматически вернуть нельзя,
 *   возврат ждёт ручного подтверждения финансистом.
 */
export type RefundMode = 'gateway' | 'certificate' | 'manual';

export function refundModeFor(method: PaymentMethod): RefundMode {
  switch (method) {
    case 'online':
      return 'gateway';
    case 'gift_certificate':
      return 'certificate';
    case 'on_receipt':
    case 'bank_transfer':
      return 'manual';
  }
}

export interface RefundProps {
  id: string;
  paymentId: string;
  amount: Money;
  status: RefundStatus;
  mode: RefundMode;
  reason: string;
  idempotencyKey: string;
  externalRefundId: string | null;
  attempts: number;
  failureReason: string | null;
  comment: string | null;
  requestedBy: string | null;
  completedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
}

export class Refund {
  private constructor(private props: RefundProps) {}

  static request(
    input: { id: string; paymentId: string; amount: Money; mode: RefundMode; reason: string; idempotencyKey: string; requestedBy: string | null },
    now: Date,
  ): Refund {
    const reason = input.reason.trim();
    if (!reason) throw new ValidationError('refund.reason_required', 'Refund reason is required');
    if (!input.amount.isPositive()) throw new ValidationError('refund.amount_invalid', 'Refund amount must be positive');
    if (!input.idempotencyKey.trim()) throw new ValidationError('refund.idempotency_key_required', 'Idempotency key is required');
    return new Refund({
      id: input.id,
      paymentId: input.paymentId,
      amount: input.amount,
      status: 'pending',
      mode: input.mode,
      reason: reason.slice(0, 1000),
      idempotencyKey: input.idempotencyKey,
      externalRefundId: null,
      attempts: 0,
      failureReason: null,
      comment: null,
      requestedBy: input.requestedBy,
      completedBy: null,
      completedAt: null,
      createdAt: now,
    });
  }

  static restore(props: RefundProps): Refund {
    return new Refund({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get paymentId(): string {
    return this.props.paymentId;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get status(): RefundStatus {
    return this.props.status;
  }
  get mode(): RefundMode {
    return this.props.mode;
  }
  get reason(): string {
    return this.props.reason;
  }
  get idempotencyKey(): string {
    return this.props.idempotencyKey;
  }

  snapshot(): Readonly<RefundProps> {
    return { ...this.props };
  }

  isPending(): boolean {
    return this.props.status === 'pending';
  }

  succeed(input: { now: Date; externalRefundId?: string | null; comment?: string | null; completedBy?: string | null }): void {
    RefundFsm.assertTransition(this.props.status, 'succeeded');
    this.props.status = 'succeeded';
    this.props.externalRefundId = input.externalRefundId ?? this.props.externalRefundId;
    this.props.comment = input.comment?.trim() || this.props.comment;
    this.props.completedBy = input.completedBy ?? null;
    this.props.completedAt = input.now;
  }

  fail(input: { now: Date; reason: string; completedBy?: string | null }): void {
    RefundFsm.assertTransition(this.props.status, 'failed');
    this.props.status = 'failed';
    this.props.failureReason = input.reason.slice(0, 1000);
    this.props.completedBy = input.completedBy ?? null;
    this.props.completedAt = input.now;
  }

  toView(): RefundView {
    return {
      id: this.props.id,
      paymentId: this.props.paymentId,
      amount: this.props.amount,
      status: this.props.status,
      reason: this.props.reason,
      createdAt: this.props.createdAt,
    };
  }
}

/** Сумма «занятых» возвратов (ожидающие + прошедшие) — не даёт двум возвратам превысить платёж. */
export function reservedRefundTotal(refunds: ReadonlyArray<{ status: RefundStatus; amount: Money }>, currency: Money['currency']): Money {
  return Money.sum(
    refunds.filter((r) => r.status !== 'failed').map((r) => r.amount),
    currency,
  );
}
