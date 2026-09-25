import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { Order } from '../domain/order';
import { CancelReasonCode, isCancelReasonCode, StaffTransitionTarget, STAFF_TRANSITION_TARGETS } from '../domain/order-status';
import { cleanText } from '../domain/order-rules';
import { OrderRefundRecord } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { OrderStatus } from '../public';
import { OrderTransitionRecorder } from './order-transition-recorder';
import { RequestOrderRefunds } from './request-order-refunds';
import { SettleCancelledOrder } from './settle-cancelled-order';

export interface CancelOrderInput {
  reasonCode: CancelReasonCode;
  reason?: string | null;
  /** Частичный возврат оплаченного заказа (требует orders.refund); не задан — полный возврат. */
  refundAmount?: Money | null;
  /** Отменить, только если заказ всё ещё в этом статусе (автоотмена неоплаченных). */
  expectedStatus?: OrderStatus;
}

export interface OrderActionResult {
  order: Order;
  refunds: OrderRefundRecord[];
}

async function lockOrder(orders: OrderRepository, orderId: string): Promise<Order> {
  const order = await orders.findById(orderId, { forUpdate: true });
  if (!order) throw new NotFoundError('order', orderId);
  return order;
}

function assertReason(code: string): CancelReasonCode {
  if (!isCancelReasonCode(code)) throw new ValidationError('order.invalid_cancel_reason', 'Unknown cancel reason code', { reasonCode: code });
  return code;
}

function assertRefundAmount(actor: Actor, order: Order, amount: Money | null | undefined): Money | null {
  if (amount === null || amount === undefined) return null;
  actor.assertCan(Permission.OrdersRefund, order.branchId);
  if (amount.isNegative()) throw new ValidationError('order.refund_invalid_amount', 'Refund amount must not be negative');
  return amount;
}

function reasonText(code: CancelReasonCode, reason: string | null): string {
  return reason ? `Отмена заказа (${code}): ${reason}` : `Отмена заказа (${code})`;
}

/**
 * Смена статуса сотрудником (экран оператора): принять, готовить, готов, в пути, выполнен.
 * Переход проверяет автомат заказа; недопустимый — 409 order.invalid_transition.
 */
@Injectable()
export class TransitionOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly recorder: OrderTransitionRecorder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, orderId: string, to: StaffTransitionTarget): Promise<Order> {
    if (!(STAFF_TRANSITION_TARGETS as readonly string[]).includes(to)) {
      throw new ValidationError('order.invalid_staff_transition', 'Use cancel/reject for cancellation', { to });
    }
    return this.database.transaction(async () => {
      const order = await lockOrder(this.orders, orderId);
      actor.assertCan(Permission.OrdersManage, order.branchId);
      const before = order.auditView();
      order.applyStaffTransition(to, this.clock.now());
      await this.orders.save(order);
      await this.recorder.record(order, { actor, before });
      return order;
    });
  }
}

/**
 * Отмена заказа сотрудником или системой: только из awaiting_payment и accepted (схема ТЗ).
 * Неоплаченные платежи отменяются, промокод освобождается (до оплаты), полученные деньги возвращаются —
 * по умолчанию полностью, частичная сумма — только с правом orders.refund.
 */
@Injectable()
export class CancelOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly recorder: OrderTransitionRecorder,
    private readonly settle: SettleCancelledOrder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, orderId: string, input: CancelOrderInput): Promise<OrderActionResult | null> {
    const reasonCode = assertReason(input.reasonCode);
    return this.database.transaction(async () => {
      const order = await lockOrder(this.orders, orderId);
      actor.assertCan(Permission.OrdersManage, order.branchId);
      if (input.expectedStatus && order.status !== input.expectedStatus) return null;
      const refundAmount = assertRefundAmount(actor, order, input.refundAmount);
      if (refundAmount && !order.snapshot().wasPaid) {
        throw new ValidationError('order.refund_amount_not_applicable', 'The order was not paid: nothing to refund partially');
      }
      if (order.status === 'paid') {
        throw new ConflictError('order.use_reject', 'A paid order that was not accepted is rejected, not cancelled', { status: order.status });
      }
      const reason = cleanText(input.reason, 500);
      const before = order.auditView();
      order.cancel(reasonCode, reason, this.clock.now());
      await this.orders.save(order);
      await this.recorder.record(order, { actor, before });
      const refunds = await this.settle.execute(order, { actor, refundAmount, reason: reasonText(reasonCode, reason) });
      return { order, refunds };
    });
  }
}

/**
 * Отказ ресторана от оплаченного заказа (нет продуктов, не можем доставить): схема ТЗ не допускает
 * paid → cancelled, поэтому выполняются два разрешённых перехода paid → accepted → cancelled в одной
 * транзакции (оба — в истории и журнале), затем возврат (полный или частичный с правом orders.refund).
 */
@Injectable()
export class RejectOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly recorder: OrderTransitionRecorder,
    private readonly settle: SettleCancelledOrder,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, orderId: string, input: CancelOrderInput): Promise<OrderActionResult> {
    const reasonCode = assertReason(input.reasonCode);
    return this.database.transaction(async () => {
      const order = await lockOrder(this.orders, orderId);
      actor.assertCan(Permission.OrdersManage, order.branchId);
      const refundAmount = assertRefundAmount(actor, order, input.refundAmount);
      const reason = cleanText(input.reason, 500);
      const before = order.auditView();
      order.reject(reasonCode, reason, this.clock.now());
      await this.orders.save(order);
      // Промежуточное «принят» гостю не отправляем — только итог «отменён».
      await this.recorder.record(order, { actor, before, silentGuestStatuses: ['accepted'] });
      const refunds = await this.settle.execute(order, { actor, refundAmount, reason: reasonText(reasonCode, reason) });
      return { order, refunds };
    });
  }
}

/**
 * Частичный возврат по заказу от принятия до выполнения (недовложение, опоздание): операция над
 * платежами, статус заказа не меняется. Право orders.refund в филиале заказа.
 */
@Injectable()
export class RefundOrder {
  constructor(
    private readonly orders: OrderRepository,
    private readonly refunds: RequestOrderRefunds,
    private readonly database: Database,
  ) {}

  async execute(actor: Actor, orderId: string, input: { amount: Money; reason: string }): Promise<OrderActionResult> {
    return this.database.transaction(async () => {
      const order = await lockOrder(this.orders, orderId);
      actor.assertCan(Permission.OrdersRefund, order.branchId);
      if (!order.canPartialRefund()) {
        throw new ConflictError('order.refund_not_allowed', 'Partial refund is possible from acceptance to completion', { status: order.status });
      }
      if (!input.amount.isPositive()) throw new ValidationError('order.refund_invalid_amount', 'Refund amount must be positive');
      const reason = cleanText(input.reason, 500);
      if (!reason) throw new ValidationError('order.refund_reason_required', 'Refund reason is required');
      const refunds = await this.refunds.execute({ order, amount: input.amount, kind: 'partial', reason, actor });
      return { order, refunds };
    });
  }
}
