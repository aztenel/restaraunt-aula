import { invariant } from '../../../shared/kernel/errors';
import { StateMachine } from '../../../shared/kernel/state-machine';
import { PosFailureReason } from '../public';

/**
 * Передача заказа в POS. Одна запись на заказ.
 *
 * pending — ждёт передачи (в том числе между повторами при недоступности POS);
 * sent — заказ передан в POS (confirmedAt — POS подтвердила создание; часть POS создаёт заказ асинхронно
 * и может отклонить его позже: тогда sent -> failed); failed — не передан (кухня работает по экрану админки,
 * персонал оповещён);
 * skipped — передавать не нужно (POS без API — провайдер manual, заказ отменён до передачи).
 * Ручной повтор: failed/skipped -> pending.
 */
export const OrderExportStatus = {
  Pending: 'pending',
  Sent: 'sent',
  Failed: 'failed',
  Skipped: 'skipped',
} as const;
export type OrderExportStatus = (typeof OrderExportStatus)[keyof typeof OrderExportStatus];
export const ORDER_EXPORT_STATUSES = Object.values(OrderExportStatus);

export const ORDER_EXPORT_MACHINE = new StateMachine<OrderExportStatus>('pos.order_export', {
  pending: ['sent', 'failed', 'skipped'],
  failed: ['pending'],
  skipped: ['pending'],
  sent: ['failed'],
});

export const POS_FAILURE_REASONS: readonly PosFailureReason[] = [
  'missing_mapping',
  'not_configured',
  'rejected',
  'retries_exhausted',
  'order_unavailable',
];

/**
 * Почему передача пропущена: manual_provider — у точки нет POS с API (кухня работает по экрану админки);
 * order_cancelled — заказ отменён до передачи; order_not_accepted — заказ ещё/уже не в работе кухни.
 */
export const SKIP_REASONS = ['manual_provider', 'order_cancelled', 'order_not_accepted'] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** Сколько раз пытаться передать заказ при недоступности POS до признания неудачи. */
export const PUSH_MAX_ATTEMPTS = 6;

/** Сколько раз проверять асинхронно создаваемый заказ, прежде чем попросить персонал проверить кассу. */
export const CONFIRM_MAX_CHECKS = 6;

export type ConfirmationOutcome = 'confirmed' | 'wait' | 'gave_up' | 'rejected';

/** Блюдо заказа (и его опции), для которых нет сопоставления с товаром POS. */
export interface MissingMapping {
  dishId: string;
  dishName: string;
  /** Нет сопоставления самого блюда. */
  dishMissing: boolean;
  /** Опции модификаторов без сопоставления. */
  options: Array<{ optionId: string; name: string }>;
}

export interface OrderExportDetails {
  missing?: MissingMapping[];
}

export interface OrderExportState {
  id: string;
  orderId: string;
  orderNumber: string;
  branchId: string;
  provider: string;
  status: OrderExportStatus;
  posOrderId: string | null;
  attempts: number;
  manualRetries: number;
  lastError: string | null;
  failureReason: PosFailureReason | null;
  skipReason: SkipReason | null;
  details: OrderExportDetails;
  lastAttemptAt: Date | null;
  sentAt: Date | null;
  /** POS подтвердила создание заказа (null — ещё нет или переданный заказ не подтверждён). */
  confirmedAt: Date | null;
  confirmChecks: number;
  failedAt: Date | null;
  createdAt: Date;
}

const MAX_ERROR_LENGTH = 2000;

function clipError(message: string): string {
  const text = message.trim() || 'Unknown error';
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

export class OrderExport {
  private constructor(private state: OrderExportState) {}

  static create(input: { id: string; orderId: string; orderNumber: string; branchId: string; provider: string; now: Date }): OrderExport {
    return new OrderExport({
      id: input.id,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      branchId: input.branchId,
      provider: input.provider,
      status: OrderExportStatus.Pending,
      posOrderId: null,
      attempts: 0,
      manualRetries: 0,
      lastError: null,
      failureReason: null,
      skipReason: null,
      details: {},
      lastAttemptAt: null,
      sentAt: null,
      confirmedAt: null,
      confirmChecks: 0,
      failedAt: null,
      createdAt: input.now,
    });
  }

  static restore(state: OrderExportState): OrderExport {
    return new OrderExport({ ...state, details: { ...state.details } });
  }

  get id(): string {
    return this.state.id;
  }

  get status(): OrderExportStatus {
    return this.state.status;
  }

  get attempts(): number {
    return this.state.attempts;
  }

  snapshot(): OrderExportState {
    return { ...this.state, details: { ...this.state.details } };
  }

  /** Можно ли повторить передачу вручную (для кнопки в админке). */
  canRetry(): boolean {
    return ORDER_EXPORT_MACHINE.canTransition(this.state.status, OrderExportStatus.Pending);
  }

  /** Ожидает ли запись передачи (задача должна что-то делать). */
  isPending(): boolean {
    return this.state.status === OrderExportStatus.Pending;
  }

  /** Провайдер определяется при каждой попытке: маршрутизацию филиала могли поменять. */
  useProvider(provider: string): void {
    invariant(this.isPending(), 'pos.order_export_not_pending', 'Provider can change only while pending');
    this.state.provider = provider;
  }

  /** Начало очередной попытки передачи. */
  startAttempt(now: Date): void {
    invariant(this.isPending(), 'pos.order_export_not_pending', 'Attempt is possible only while pending');
    this.state.attempts += 1;
    this.state.lastAttemptAt = now;
  }

  /** Заказ передан. confirmed=false — POS создаёт его асинхронно, нужна проверка (checkOrder). */
  markSent(posOrderId: string, now: Date, confirmed = true): void {
    invariant(posOrderId.trim().length > 0, 'pos.pos_order_id_required', 'POS order id is required');
    ORDER_EXPORT_MACHINE.assertTransition(this.state.status, OrderExportStatus.Sent);
    this.state.status = OrderExportStatus.Sent;
    this.state.posOrderId = posOrderId;
    this.state.sentAt = now;
    this.state.confirmedAt = confirmed ? now : null;
    this.state.confirmChecks = 0;
    this.state.lastError = null;
    this.state.failureReason = null;
    this.state.details = {};
  }

  /** Передан, но POS ещё не подтвердила создание. */
  needsConfirmation(): boolean {
    return this.state.status === OrderExportStatus.Sent && this.state.confirmedAt === null;
  }

  /**
   * Результат проверки асинхронно создаваемого заказа:
   * created -> confirmed; failed -> POS отклонила заказ (sent -> failed); in_progress/ошибка проверки ->
   * ждать и проверить позже, после maxChecks — gave_up (заказ остаётся sent без подтверждения, персонал проверяет кассу).
   */
  recordConfirmation(
    check: { state: 'created' } | { state: 'in_progress'; error?: string } | { state: 'failed'; error: string },
    now: Date,
    maxChecks: number = CONFIRM_MAX_CHECKS,
  ): ConfirmationOutcome {
    invariant(this.needsConfirmation(), 'pos.order_export_not_awaiting_confirmation', 'Export is not awaiting confirmation');
    this.state.confirmChecks += 1;
    if (check.state === 'created') {
      this.state.confirmedAt = now;
      this.state.lastError = null;
      return 'confirmed';
    }
    if (check.state === 'failed') {
      this.markFailed('rejected', check.error, now);
      return 'rejected';
    }
    if (check.error) this.state.lastError = clipError(check.error);
    return this.state.confirmChecks >= maxChecks ? 'gave_up' : 'wait';
  }

  markSkipped(reason: SkipReason, now: Date): void {
    ORDER_EXPORT_MACHINE.assertTransition(this.state.status, OrderExportStatus.Skipped);
    this.state.status = OrderExportStatus.Skipped;
    this.state.skipReason = reason;
    this.state.lastAttemptAt ??= now;
  }

  /** Неудача без повторов (нет сопоставления, не настроено, POS отклонила заказ). */
  markFailed(reason: PosFailureReason, error: string, now: Date, details: OrderExportDetails = {}): void {
    ORDER_EXPORT_MACHINE.assertTransition(this.state.status, OrderExportStatus.Failed);
    this.state.status = OrderExportStatus.Failed;
    this.state.failureReason = reason;
    this.state.lastError = clipError(error);
    this.state.failedAt = now;
    this.state.details = { ...details };
  }

  /**
   * Временная неудача (POS недоступна). Пока попытки не исчерпаны — запись остаётся pending
   * и задача повторяется с экспоненциальной задержкой; после maxAttempts — failed.
   */
  recordTemporaryFailure(error: string, now: Date, maxAttempts: number = PUSH_MAX_ATTEMPTS): 'retry' | 'exhausted' {
    invariant(this.isPending(), 'pos.order_export_not_pending', 'Failure is recorded only while pending');
    if (this.state.attempts >= maxAttempts) {
      this.markFailed('retries_exhausted', error, now);
      return 'exhausted';
    }
    this.state.lastError = clipError(error);
    return 'retry';
  }

  /** Ручной повтор: новый цикл попыток. */
  retry(): void {
    ORDER_EXPORT_MACHINE.assertTransition(this.state.status, OrderExportStatus.Pending);
    this.state.status = OrderExportStatus.Pending;
    this.state.attempts = 0;
    this.state.manualRetries += 1;
    this.state.lastError = null;
    this.state.failureReason = null;
    this.state.skipReason = null;
    this.state.details = {};
    this.state.failedAt = null;
    this.state.confirmedAt = null;
    this.state.confirmChecks = 0;
  }
}
