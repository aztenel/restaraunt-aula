import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Page, PageRequest } from '../../../shared/kernel/pagination';
import { Permission } from '../../../shared/kernel/permissions';
import { addMinutes } from '../../../shared/kernel/time';
import { BranchDirectory, BranchInfo, StaffDirectory } from '../../identity/public';
import { PaymentView } from '../../payments/public';
import { CourierDispatchStatus, isTerminalDispatchStatus } from '../domain/courier-dispatch';
import { DeliveryZoneState } from '../domain/delivery-zone';
import { Order, OrderItemSnapshot, OrderState } from '../domain/order';
import { ACTIVE_ORDER_STATUSES } from '../domain/order-status';
import { totalRefundable } from '../domain/payment-plan';
import { CourierDispatchRecord, CourierDispatchRepository } from '../infrastructure/courier-dispatch.repository';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';
import { OrderPaymentKind, OrderPaymentsRepository, OrderRefundRecord } from '../infrastructure/order-payments.repository';
import { OrderListFilter, OrderRepository, StatusHistoryEntry } from '../infrastructure/order.repository';
import { OrderStatus } from '../public';
import { CourierDispatchRegistry } from './courier-dispatch.registry';
import { OrderPaymentState } from './order-payment-state';

export interface OrderPaymentSummary {
  /** Списано с сертификата. */
  certificateAmount: Money;
  /** К оплате онлайн / при получении (итог минус сертификат). */
  amountDue: Money;
  /** Текущий платёж остатка (ссылка на оплату появляется асинхронно). */
  current: PaymentView | null;
  /** Можно повторить онлайн-оплату (прошлая попытка отклонена/отменена, срок не истёк). */
  canRetry: boolean;
  /** Срок оплаты неоплаченного онлайн-заказа. */
  payUntil: Date | null;
}

export interface OrderTrackingView {
  order: OrderState;
  branch: BranchInfo;
  history: StatusHistoryEntry[];
  payment: OrderPaymentSummary;
  courier: { status: CourierDispatchStatus; trackingUrl: string | null; courierName: string | null } | null;
}

export interface OrderPaymentLine {
  payment: PaymentView;
  kind: OrderPaymentKind | null;
  attempt: number | null;
}

export interface OrderDetailsView extends OrderTrackingView {
  payments: OrderPaymentLine[];
  refunds: OrderRefundRecord[];
  dispatch: CourierDispatchRecord | null;
  zone: DeliveryZoneState | null;
  /** Переходы, доступные сотруднику (сервер решает, фронт только показывает кнопки). */
  allowedTransitions: OrderStatus[];
  canCancel: boolean;
  canReject: boolean;
  canRefund: boolean;
  refundable: Money;
  /** Можно повторно вызвать курьера службы доставки (заказ «Готов», активной заявки нет, филиал работает со службой). */
  canRetryCourier: boolean;
  /** Есть активная заявка службы доставки, её можно отменить. */
  canCancelCourier: boolean;
  /** Имя сотрудника, оформившего телефонный заказ. */
  createdByName: string | null;
}

export interface OrderQueueCourier {
  status: CourierDispatchStatus;
  trackingUrl: string | null;
  courierName: string | null;
}

export interface OrderQueueCard {
  order: OrderState;
  allowedTransitions: OrderStatus[];
  /** Обещанное время прошло, а заказ ещё не выдан. */
  isLate: boolean;
  canCancel: boolean;
  canReject: boolean;
  /** Последняя заявка службы доставки (null — свои курьеры или заявки не было). */
  courier: OrderQueueCourier | null;
  /** Сколько получить с гостя при получении (0 — оплачено онлайн и/или сертификатом). */
  amountDue: Money;
}

export interface OrderQueueView {
  generatedAt: Date;
  groups: Array<{ status: OrderStatus; orders: OrderQueueCard[] }>;
}

/** Чтение заказов: страница статуса для гостя (по публичному токену) и админка (список, очередь, карточка). */
@Injectable()
export class OrderQueries {
  constructor(
    private readonly orders: OrderRepository,
    private readonly branches: BranchDirectory,
    private readonly state: OrderPaymentState,
    private readonly dispatches: CourierDispatchRepository,
    private readonly zones: DeliveryZoneRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly registry: CourierDispatchRegistry,
    private readonly staff: StaffDirectory,
    private readonly clock: Clock,
  ) {}

  async tracking(publicToken: string): Promise<OrderTrackingView> {
    const order = await this.orders.findByPublicToken(publicToken);
    if (!order) throw new NotFoundError('order');
    return (await this.view(order)).tracking;
  }

  async details(actor: Actor, orderId: string): Promise<OrderDetailsView> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundError('order', orderId);
    actor.assertCan(Permission.OrdersView, order.branchId);
    const { tracking, snapshot, dispatch } = await this.view(order);
    const s = order.snapshot();
    const linkBy = new Map(snapshot.links.map((l) => [l.paymentId, l]));
    const refundable = totalRefundable(snapshot.positions);
    const canManage = actor.can(Permission.OrdersManage, order.branchId);
    const activeDispatch = dispatch !== null && !isTerminalDispatchStatus(dispatch.status);
    const creator = s.createdBy ? await this.staff.get(s.createdBy) : null;
    return {
      ...tracking,
      payments: snapshot.views.map((v) => ({ payment: v, kind: linkBy.get(v.id)?.kind ?? null, attempt: linkBy.get(v.id)?.attempt ?? null })),
      refunds: snapshot.refunds,
      dispatch,
      zone: s.delivery?.zoneId ? await this.zones.findById(s.delivery.zoneId, { includeDeleted: true }) : null,
      allowedTransitions: canManage ? order.staffTransitions() : [],
      canCancel: canManage && order.canCancel(),
      canReject: canManage && order.canReject(),
      canRefund: actor.can(Permission.OrdersRefund, order.branchId) && order.canPartialRefund() && refundable.isPositive(),
      refundable,
      canRetryCourier: canManage && s.type === 'delivery' && s.status === 'ready' && !activeDispatch && (await this.usesExternalCouriers(s.branchId)),
      canCancelCourier: canManage && activeDispatch,
      createdByName: creator?.name ?? null,
    };
  }

  /** Филиал работает со службой доставки (ошибка настройки маршрутизации — считаем, что нет). */
  private async usesExternalCouriers(branchId: string): Promise<boolean> {
    try {
      return (await this.registry.resolve(branchId)).external;
    } catch {
      return false;
    }
  }

  async list(actor: Actor, filter: Omit<OrderListFilter, 'branches'> & { branchId?: string | null }, page: PageRequest): Promise<Page<OrderState>> {
    const branches = actor.scopeBranches(Permission.OrdersView, filter.branchId ?? null);
    return this.orders.list({ ...filter, branches }, page);
  }

  /** Очередь оператора: активные заказы, сгруппированные по статусу (с позициями — для кухни). */
  async queue(actor: Actor, branchId?: string | null): Promise<OrderQueueView> {
    const branches = actor.scopeBranches(Permission.OrdersView, branchId ?? null);
    const states = await this.orders.active(branches, ACTIVE_ORDER_STATUSES);
    const ids = states.map((s) => s.id);
    const [items, links, dispatches] = await Promise.all([
      this.orders.itemsForOrders(ids),
      this.orderPayments.listForOrders(ids),
      this.dispatches.latestForOrders(ids),
    ]);
    const now = this.clock.now();
    const cards = states.map((s): OrderQueueCard => {
      const order = Order.restore({ ...s, items: items.get(s.id) ?? ([] as OrderItemSnapshot[]) });
      const canManage = actor.can(Permission.OrdersManage, s.branchId);
      const dispatch = dispatches.get(s.id) ?? null;
      const onReceipt = (links.get(s.id) ?? []).filter((l) => l.kind === 'on_receipt').map((l) => l.amount);
      return {
        order: order.snapshot(),
        allowedTransitions: canManage ? order.staffTransitions() : [],
        isLate: s.status !== 'awaiting_payment' && s.promisedAt.getTime() < now.getTime(),
        canCancel: canManage && order.canCancel(),
        canReject: canManage && order.canReject(),
        courier: dispatch ? { status: dispatch.status, trackingUrl: dispatch.trackingUrl, courierName: dispatch.courierName } : null,
        amountDue: Money.sum(onReceipt, s.totals.total.currency),
      };
    });
    return {
      generatedAt: now,
      groups: ACTIVE_ORDER_STATUSES.map((status) => ({ status, orders: cards.filter((c) => c.order.status === status) })),
    };
  }

  private async view(order: Order) {
    const s = order.snapshot();
    const [branch, history, snapshot, dispatch] = await Promise.all([
      this.branches.get(s.branchId),
      this.orders.history(s.id),
      this.state.load(s.id),
      this.dispatches.latestForOrder(s.id),
    ]);
    const certificateAmount = Money.sum(snapshot.links.filter((l) => l.kind === 'certificate').map((l) => l.amount));
    const current = s.currentPaymentId ? (snapshot.views.find((v) => v.id === s.currentPaymentId) ?? null) : null;
    const payUntil =
      s.status === 'awaiting_payment' && s.paymentMethod === 'online'
        ? addMinutes(s.timestamps.placedAt, branch.settings.awaitingPaymentTimeoutMinutes)
        : null;
    const canRetry =
      payUntil !== null && current !== null && (current.status === 'failed' || current.status === 'cancelled') && this.clock.now() < payUntil;
    const tracking: OrderTrackingView = {
      order: s,
      branch,
      history,
      payment: { certificateAmount, amountDue: s.totals.total.subtract(certificateAmount).clampToZero(), current, canRetry, payUntil },
      courier: dispatch ? { status: dispatch.status, trackingUrl: dispatch.trackingUrl, courierName: dispatch.courierName } : null,
    };
    return { tracking, snapshot, dispatch };
  }
}
