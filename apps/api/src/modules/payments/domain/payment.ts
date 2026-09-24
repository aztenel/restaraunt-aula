import { ConflictError, InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { PaymentMethod, PaymentPurpose, PaymentStatus, PaymentView } from '../public';

/**
 * Платёж. Статус меняется только методами сущности по конечному автомату:
 *
 *   created -> pending -> succeeded | failed | cancelled
 *   succeeded -> partially_refunded -> refunded   (и succeeded -> refunded при полном возврате)
 *
 * Дополнительно: failed/cancelled -> succeeded — «поздняя оплата». Провайдер подтвердил списание
 * уже после отказа/отмены (гость оплатил на открытой странице). Деньги получены — факт фиксируется,
 * а потребитель (заказ, бронь) решает, возвращать ли их (см. decisions.md: платёж после отмены
 * заказа возвращается полностью).
 */
export const PaymentFsm = new StateMachine<PaymentStatus>('payment', {
  created: ['pending', 'failed', 'cancelled'],
  pending: ['succeeded', 'failed', 'cancelled'],
  succeeded: ['partially_refunded', 'refunded'],
  partially_refunded: ['refunded'],
  failed: ['succeeded'],
  cancelled: ['succeeded'],
  refunded: [],
});

/** Статусы, в которых деньги получены (есть что возвращать или уже возвращено). */
export const MONEY_RECEIVED_STATUSES: readonly PaymentStatus[] = ['succeeded', 'partially_refunded', 'refunded'];
/** Статусы «ещё не оплачен». */
export const OPEN_STATUSES: readonly PaymentStatus[] = ['created', 'pending'];

export interface PaymentCustomer {
  phone: string | null;
  name: string | null;
  email: string | null;
}

export interface PaymentProps {
  id: string;
  invoiceNo: number;
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  method: PaymentMethod;
  provider: string;
  status: PaymentStatus;
  amount: Money;
  refunded: Money;
  externalId: string | null;
  paymentUrl: string | null;
  providerData: Record<string, unknown>;
  description: string;
  customer: PaymentCustomer;
  returnUrl: string | null;
  idempotencyKey: string;
  certificateId: string | null;
  documentNumber: string | null;
  failureReason: string | null;
  cancelReason: string | null;
  initiateAttempts: number;
  expiresAt: Date | null;
  paidAt: Date | null;
  failedAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
}

export interface NewPaymentInput {
  id: string;
  purpose: PaymentPurpose;
  referenceId: string;
  branchId: string | null;
  method: PaymentMethod;
  provider: string;
  amount: Money;
  description: string;
  customer: PaymentCustomer;
  returnUrl: string | null;
  idempotencyKey: string;
  certificateId?: string | null;
  documentNumber?: string | null;
  expiresAt?: Date | null;
  /** Для банковского перевода — дата поступления по выписке. */
  paidAt?: Date | null;
}

/** Результат попытки применить подтверждение провайдера. */
export type ConfirmationOutcome = 'applied' | 'ignored' | 'amount_mismatch';

export class Payment {
  private constructor(private props: PaymentProps) {}

  /**
   * Новый платёж. Начальный статус зависит от способа:
   * online — created (инициирование у провайдера в очереди); on_receipt — pending (ждём деньги);
   * gift_certificate и bank_transfer — succeeded (деньги уже получены: списаны с сертификата / пришли на счёт).
   */
  static create(input: NewPaymentInput, now: Date): Payment {
    if (!input.amount.isPositive()) {
      throw new ValidationError('payment.amount_invalid', 'Payment amount must be positive');
    }
    if (!input.referenceId.trim()) {
      throw new ValidationError('payment.reference_required', 'Payment reference is required');
    }
    if (!input.idempotencyKey.trim()) {
      throw new ValidationError('payment.idempotency_key_required', 'Idempotency key is required');
    }
    if (input.expiresAt && input.expiresAt.getTime() <= now.getTime()) {
      throw new ValidationError('payment.expires_in_past', 'Payment expiry must be in the future');
    }
    const initial: Record<PaymentMethod, PaymentStatus> = {
      online: 'created',
      on_receipt: 'pending',
      gift_certificate: 'succeeded',
      bank_transfer: 'succeeded',
    };
    const status = initial[input.method];
    if (input.method === 'gift_certificate' && !input.certificateId) {
      throw new ValidationError('payment.certificate_required', 'Certificate is required for gift_certificate payments');
    }
    if (input.method === 'bank_transfer' && !input.documentNumber?.trim()) {
      throw new ValidationError('payment.document_required', 'Bank transfer needs a payment document number');
    }
    return new Payment({
      id: input.id,
      invoiceNo: 0,
      purpose: input.purpose,
      referenceId: input.referenceId,
      branchId: input.branchId,
      method: input.method,
      provider: input.provider,
      status,
      amount: input.amount,
      refunded: Money.zero(input.amount.currency),
      externalId: null,
      paymentUrl: null,
      providerData: {},
      description: input.description.trim().slice(0, 500) || '—',
      customer: input.customer,
      returnUrl: input.returnUrl,
      idempotencyKey: input.idempotencyKey,
      certificateId: input.certificateId ?? null,
      documentNumber: input.documentNumber?.trim() || null,
      failureReason: null,
      cancelReason: null,
      initiateAttempts: 0,
      expiresAt: input.method === 'online' || input.method === 'on_receipt' ? (input.expiresAt ?? null) : null,
      paidAt: status === 'succeeded' ? (input.paidAt ?? now) : null,
      failedAt: null,
      cancelledAt: null,
      createdAt: now,
    });
  }

  static restore(props: PaymentProps): Payment {
    return new Payment({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): PaymentStatus {
    return this.props.status;
  }
  get method(): PaymentMethod {
    return this.props.method;
  }
  get provider(): string {
    return this.props.provider;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get refunded(): Money {
    return this.props.refunded;
  }
  get branchId(): string | null {
    return this.props.branchId;
  }
  get purpose(): PaymentPurpose {
    return this.props.purpose;
  }
  get referenceId(): string {
    return this.props.referenceId;
  }
  get externalId(): string | null {
    return this.props.externalId;
  }
  get expiresAt(): Date | null {
    return this.props.expiresAt;
  }

  snapshot(): Readonly<PaymentProps> {
    return { ...this.props, customer: { ...this.props.customer }, providerData: { ...this.props.providerData } };
  }

  isOpen(): boolean {
    return OPEN_STATUSES.includes(this.props.status);
  }

  isMoneyReceived(): boolean {
    return MONEY_RECEIVED_STATUSES.includes(this.props.status);
  }

  isFullyRefunded(): boolean {
    return this.props.status === 'refunded';
  }

  isExpired(now: Date): boolean {
    return this.props.expiresAt !== null && this.props.expiresAt.getTime() <= now.getTime();
  }

  allowedTransitions(): readonly PaymentStatus[] {
    return PaymentFsm.allowedFrom(this.props.status);
  }

  private transition(to: PaymentStatus): void {
    PaymentFsm.assertTransition(this.props.status, to);
    this.props.status = to;
  }

  /** Попытка инициирования у провайдера (учёт для лимита повторов). */
  registerInitiateAttempt(): number {
    this.props.initiateAttempts += 1;
    return this.props.initiateAttempts;
  }

  /** Провайдер создал платёж: есть внешний id и ссылка на страницу оплаты. created -> pending. */
  markInitiated(input: {
    externalId: string;
    paymentUrl: string;
    expiresAt: Date | null;
    providerData?: Record<string, unknown>;
  }): void {
    if (!input.externalId.trim() || !input.paymentUrl.trim()) {
      throw new ValidationError('payment.gateway_response_invalid', 'Gateway returned no external id or payment url');
    }
    this.transition('pending');
    this.props.externalId = input.externalId;
    this.props.paymentUrl = input.paymentUrl;
    this.mergeProviderData(input.providerData);
    // Срок жизни — меньший из заданного вызывающим модулем и срока страницы оплаты у провайдера.
    const candidates = [this.props.expiresAt, input.expiresAt].filter((d): d is Date => d instanceof Date);
    this.props.expiresAt = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  }

  mergeProviderData(data: Record<string, unknown> | undefined): void {
    if (data && Object.keys(data).length > 0) {
      this.props.providerData = { ...this.props.providerData, ...data };
    }
  }

  /**
   * Подтверждение оплаты от провайдера (вебхук, опрос статуса). Если провайдер сообщил сумму,
   * она должна совпасть с суммой платежа — иначе платёж не отмечается оплаченным.
   * Повтор для уже оплаченного платежа ничего не меняет.
   */
  confirmPaid(now: Date, reported: Money | null): ConfirmationOutcome {
    if (this.isMoneyReceived()) return 'ignored';
    if (reported && !reported.equals(this.props.amount)) return 'amount_mismatch';
    if (!PaymentFsm.canTransition(this.props.status, 'succeeded')) return 'ignored';
    // Поздняя оплата (failed/cancelled -> succeeded) — только по подтверждению провайдера онлайн-платежа.
    if (this.props.status !== 'pending' && this.props.method !== 'online') return 'ignored';
    this.transition('succeeded');
    this.props.paidAt = now;
    return 'applied';
  }

  /** Отметить получение денег по оплате при получении (курьер/касса). Идемпотентно. */
  collect(now: Date): 'applied' | 'ignored' {
    if (this.props.method !== 'on_receipt') {
      throw new ConflictError('payment.not_on_receipt', 'Only on_receipt payments can be marked as collected');
    }
    if (this.isMoneyReceived()) return 'ignored';
    // Отменённый платёж при получении «собрать» нельзя: поздняя оплата — только у онлайн-платежей.
    if (this.props.status !== 'pending') throw new InvalidStateTransitionError('payment', this.props.status, 'succeeded');
    this.transition('succeeded');
    this.props.paidAt = now;
    return 'applied';
  }

  /** Отказ провайдера / исчерпаны попытки инициирования. Для завершённых платежей — без изменений. */
  fail(reason: string, now: Date): 'applied' | 'ignored' {
    if (!this.isOpen()) return 'ignored';
    this.transition('failed');
    this.props.failureReason = reason.slice(0, 1000);
    this.props.failedAt = now;
    return 'applied';
  }

  /** Отмена неоплаченного платежа. Идемпотентно: оплаченный/завершённый платёж не меняется. */
  cancel(reason: string, now: Date): 'applied' | 'ignored' {
    if (!this.isOpen()) return 'ignored';
    this.transition('cancelled');
    this.props.cancelReason = reason.slice(0, 1000);
    this.props.cancelledAt = now;
    return 'applied';
  }

  /** Сколько ещё можно вернуть с учётом уже запрошенных (ожидающих и прошедших) возвратов. */
  refundableRemainder(reserved: Money): Money {
    if (!this.isMoneyReceived()) return Money.zero(this.props.amount.currency);
    return this.props.amount.subtract(reserved).clampToZero();
  }

  /**
   * Проверка запроса на возврат: платёж оплачен, сумма положительна и вместе с уже запрошенными
   * не превышает сумму платежа. Не задана — возвращается весь остаток.
   */
  planRefund(requested: Money | null | undefined, reserved: Money): Money {
    if (!this.isMoneyReceived()) {
      throw new ConflictError('payment.not_refundable', 'Only paid payments can be refunded', { status: this.props.status });
    }
    const remainder = this.refundableRemainder(reserved);
    if (remainder.isZero()) {
      throw new ConflictError('payment.nothing_to_refund', 'Payment is already refunded in full');
    }
    const amount = requested ?? remainder;
    if (!amount.isPositive()) {
      throw new ValidationError('refund.amount_invalid', 'Refund amount must be positive');
    }
    if (amount.greaterThan(remainder)) {
      throw new ConflictError('payment.refund_exceeds', 'Refund exceeds the refundable remainder', {
        requested: amount.toJSON(),
        refundable: remainder.toJSON(),
      });
    }
    return amount;
  }

  /** Возврат прошёл: увеличить возвращённую сумму, succeeded -> partially_refunded -> refunded. */
  applyRefund(amount: Money): void {
    const total = this.props.refunded.add(amount);
    if (total.greaterThan(this.props.amount)) {
      throw new ConflictError('payment.refund_exceeds', 'Refunded total cannot exceed payment amount');
    }
    const next: PaymentStatus = total.equals(this.props.amount) ? 'refunded' : 'partially_refunded';
    if (next !== this.props.status) this.transition(next);
    this.props.refunded = total;
  }

  toView(): PaymentView {
    return {
      id: this.props.id,
      purpose: this.props.purpose,
      referenceId: this.props.referenceId,
      branchId: this.props.branchId,
      method: this.props.method,
      provider: this.props.provider,
      status: this.props.status,
      amount: this.props.amount,
      refundedAmount: this.props.refunded,
      paymentUrl: this.props.paymentUrl,
      externalId: this.props.externalId,
      createdAt: this.props.createdAt,
      paidAt: this.props.paidAt,
      expiresAt: this.props.expiresAt,
    };
  }
}

/**
 * Все ли платежи по объекту (заказ, бронь, счёт) возвращены полностью: каждый платёж,
 * по которому получены деньги, в статусе refunded. Неоплаченные платежи не учитываются.
 */
export function isReferenceFullyRefunded(payments: ReadonlyArray<{ status: PaymentStatus }>): boolean {
  const paid = payments.filter((p) => MONEY_RECEIVED_STATUSES.includes(p.status));
  return paid.length > 0 && paid.every((p) => p.status === 'refunded');
}
