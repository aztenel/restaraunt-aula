import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { ExternalServiceError } from '../../../shared/infrastructure/integrations/external-http';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { translate } from '../../../shared/kernel/translatable';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { AdminFeed } from '../../notifications/public';
import {
  CourierClaimInfo,
  CourierClaimRef,
  CourierClaimRequest,
  DISPATCH_CREATE_MAX_ATTEMPTS,
  DISPATCH_POLL_INTERVAL_MS,
  DISPATCH_POLL_WINDOW_MS,
  isTerminalDispatchStatus,
} from '../domain/courier-dispatch';
import { Order } from '../domain/order';
import { CourierDispatchRecord, CourierDispatchRepository } from '../infrastructure/courier-dispatch.repository';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { AdvanceOrderByCourier } from './advance-order-by-courier.action';
import { CourierDispatchRegistry } from './courier-dispatch.registry';
import { CourierJobPayload, CourierJobs, RequestCourierDispatch, ScheduleCourierCancellation } from './courier-requests';

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

function isRetryable(err: unknown): boolean {
  return err instanceof ExternalServiceError ? err.retryable : !(err instanceof DomainError);
}

function refOf(d: CourierDispatchRecord): CourierClaimRef {
  return {
    externalId: d.externalId ?? '',
    branchId: d.branchId,
    orderId: d.orderId,
    known: { trackingUrl: d.trackingUrl, courierPhone: d.courierPhone },
  };
}

function infoPatch(info: CourierClaimInfo) {
  return {
    status: info.status,
    providerStatus: info.providerStatus,
    externalId: info.externalId,
    trackingUrl: info.trackingUrl,
    courierName: info.courierName,
    courierPhone: info.courierPhone,
    price: info.price,
  };
}

function buildClaimRequest(order: Order, branch: BranchInfo, dispatchId: string, collect: Money | null): CourierClaimRequest {
  const s = order.snapshot();
  const delivery = s.delivery!;
  const notes = [s.comment, s.contactless ? 'Бесконтактная доставка: оставить у двери и позвонить' : null].filter(Boolean);
  return {
    dispatchId,
    orderId: s.id,
    orderNumber: s.number,
    branchId: s.branchId,
    pickup: {
      name: translate(branch.name, 'ru'),
      phone: branch.phone,
      address: translate(branch.address, 'ru'),
      location: branch.location,
    },
    dropoff: {
      name: s.customer.name,
      phone: s.customer.phone,
      address: delivery.addressText,
      location: delivery.point,
      apartment: delivery.apartment,
      entrance: delivery.entrance,
      floor: delivery.floor,
      intercom: delivery.intercom,
      comment: delivery.courierComment,
    },
    items: s.items.map((i) => ({ title: translate(i.name, 'ru'), quantity: i.quantity, unitPrice: i.unitPrice })),
    total: s.totals.total,
    collectOnDelivery: collect && collect.isPositive() ? collect : null,
    contactless: s.contactless,
    dueAt: s.scheduledFor,
    comment: notes.length ? notes.join('. ') : null,
  };
}

/** Задача ordering.courier_dispatch: создать заявку у службы. Повторы — с экспоненциальной задержкой. */
@Injectable()
export class CreateCourierClaim {
  private readonly logger = new Logger(CreateCourierClaim.name);

  constructor(
    private readonly dispatches: CourierDispatchRepository,
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly branches: BranchDirectory,
    private readonly registry: CourierDispatchRegistry,
    private readonly jobs: JobQueue,
    private readonly feed: AdminFeed,
    private readonly clock: Clock,
  ) {}

  async execute(payload: CourierJobPayload): Promise<void> {
    const d = await this.dispatches.findById(payload.dispatchId);
    if (!d || d.status !== 'requested') return;
    const order = await this.orders.findById(d.orderId);
    if (!order || !['ready', 'delivering'].includes(order.status)) {
      await this.dispatches.patch(d.id, { status: 'cancelled', lastError: 'order_not_ready', finishedAt: this.clock.now() });
      return;
    }
    const branch = await this.branches.get(order.branchId);
    const collect = (await this.orderPayments.listForOrder(order.id)).find((p) => p.kind === 'on_receipt')?.amount ?? null;
    const attempts = d.attempts + 1;
    await this.dispatches.patch(d.id, { attempts });
    try {
      const info = await this.registry.get(d.provider).createClaim(buildClaimRequest(order, branch, d.id, collect));
      await this.dispatches.patch(d.id, { ...infoPatch(info), lastError: null, finishedAt: isTerminalDispatchStatus(info.status) ? this.clock.now() : null });
      if (!isTerminalDispatchStatus(info.status)) {
        await this.jobs.enqueue(CourierJobs.Poll, { dispatchId: d.id } satisfies CourierJobPayload, {
          delayMs: DISPATCH_POLL_INTERVAL_MS,
          aggregateId: order.id,
          branchId: order.branchId,
        });
      }
    } catch (err) {
      if (isRetryable(err) && attempts < DISPATCH_CREATE_MAX_ATTEMPTS) {
        await this.dispatches.patch(d.id, { lastError: errorMessage(err) });
        throw err;
      }
      this.logger.error({ dispatchId: d.id, err: errorMessage(err) }, 'Courier claim failed');
      await this.dispatches.patch(d.id, { status: 'failed', lastError: errorMessage(err), finishedAt: this.clock.now() });
      await this.feed.push({
        branchId: order.branchId,
        stream: 'orders',
        kind: 'updated',
        entityId: order.id,
        title: `Заказ ${order.snapshot().number}: не удалось вызвать курьера службы доставки`,
        sound: true,
      });
    }
  }
}

/**
 * Задача ordering.courier_poll: статус заявки у службы. Подтверждает заявку после оценки,
 * обновляет курьера и ссылку отслеживания, двигает заказ (забрал — «в пути», доставил — «выполнен»).
 */
@Injectable()
export class PollCourierDispatch {
  private readonly logger = new Logger(PollCourierDispatch.name);

  constructor(
    private readonly dispatches: CourierDispatchRepository,
    private readonly registry: CourierDispatchRegistry,
    private readonly jobs: JobQueue,
    private readonly feed: AdminFeed,
    private readonly clock: Clock,
    private readonly advance: AdvanceOrderByCourier,
  ) {}

  async execute(payload: CourierJobPayload): Promise<void> {
    const d = await this.dispatches.findById(payload.dispatchId);
    if (!d || isTerminalDispatchStatus(d.status) || !d.externalId) return;
    const now = this.clock.now();
    if (now.getTime() - d.requestedAt.getTime() > DISPATCH_POLL_WINDOW_MS) {
      await this.dispatches.patch(d.id, { status: 'failed', lastError: 'poll_window_exceeded', finishedAt: now });
      return;
    }
    const dispatcher = this.registry.get(d.provider);
    let info: CourierClaimInfo;
    try {
      info = await dispatcher.getClaim(refOf(d));
      if (info.status === 'awaiting_confirmation') info = await dispatcher.confirmClaim(refOf(d));
    } catch (err) {
      if (isRetryable(err)) {
        await this.dispatches.patch(d.id, { polls: d.polls + 1, lastError: errorMessage(err) });
        await this.schedule(d);
        return;
      }
      this.logger.error({ dispatchId: d.id, err: errorMessage(err) }, 'Courier claim status failed');
      await this.dispatches.patch(d.id, { status: 'failed', lastError: errorMessage(err), finishedAt: now, polls: d.polls + 1 });
      return;
    }
    const terminal = isTerminalDispatchStatus(info.status);
    await this.dispatches.patch(d.id, { ...infoPatch(info), polls: d.polls + 1, lastError: null, finishedAt: terminal ? now : null });
    await this.advance.execute(d.orderId, info.status);
    if (!terminal) {
      await this.schedule(d);
    } else if (info.status !== 'delivered') {
      await this.feed.push({
        branchId: d.branchId,
        stream: 'orders',
        kind: 'updated',
        entityId: d.orderId,
        title: `Служба доставки: заявка ${info.status === 'cancelled' ? 'отменена' : 'не выполнена'} — нужен курьер`,
        sound: true,
      });
    }
  }

  private async schedule(d: CourierDispatchRecord): Promise<void> {
    await this.jobs.enqueue(CourierJobs.Poll, { dispatchId: d.id } satisfies CourierJobPayload, {
      delayMs: DISPATCH_POLL_INTERVAL_MS,
      aggregateId: d.orderId,
      branchId: d.branchId,
    });
  }
}

/** Задача ordering.courier_cancel: отменить заявку у службы (заказ отменён или оператор отказался от службы). */
@Injectable()
export class CancelCourierClaim {
  constructor(
    private readonly dispatches: CourierDispatchRepository,
    private readonly registry: CourierDispatchRegistry,
    private readonly clock: Clock,
  ) {}

  async execute(payload: CourierJobPayload): Promise<void> {
    const d = await this.dispatches.findById(payload.dispatchId);
    if (!d || isTerminalDispatchStatus(d.status)) return;
    if (d.externalId) {
      // Ошибка внешней службы — повтор задачи с экспоненциальной задержкой.
      await this.registry.get(d.provider).cancelClaim(refOf(d));
    }
    await this.dispatches.patch(d.id, { status: 'cancelled', finishedAt: this.clock.now() });
  }
}

/** Оператор повторно вызывает курьера службы (прошлая заявка не удалась или отменена). */
@Injectable()
export class RetryCourierDispatch {
  constructor(
    private readonly orders: OrderRepository,
    private readonly dispatches: CourierDispatchRepository,
    private readonly registry: CourierDispatchRegistry,
    private readonly request: RequestCourierDispatch,
    private readonly database: Database,
  ) {}

  async execute(actor: Actor, orderId: string): Promise<void> {
    await this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      if (!order) throw new NotFoundError('order', orderId);
      actor.assertCan(Permission.OrdersManage, order.branchId);
      if (order.type !== 'delivery' || order.status !== 'ready') {
        throw new ConflictError('courier.order_not_ready', 'Courier can be requested only for a ready delivery order', { status: order.status });
      }
      const dispatcher = await this.registry.resolve(order.branchId);
      if (!dispatcher.external) throw new ConflictError('courier.not_external', 'The branch uses its own couriers');
      const latest = await this.dispatches.latestForOrder(order.id);
      if (latest && !isTerminalDispatchStatus(latest.status)) {
        throw new ConflictError('courier.dispatch_active', 'Courier dispatch is already in progress', { dispatchId: latest.id });
      }
      await this.request.execute(order);
    });
  }
}

/** Оператор отменяет заявку службы (например, везёт свой курьер). */
@Injectable()
export class CancelCourierDispatch {
  constructor(
    private readonly orders: OrderRepository,
    private readonly schedule: ScheduleCourierCancellation,
    private readonly audit: AuditLog,
    private readonly database: Database,
  ) {}

  async execute(actor: Actor, orderId: string): Promise<void> {
    await this.database.transaction(async () => {
      const order = await this.orders.findById(orderId, { forUpdate: true });
      if (!order) throw new NotFoundError('order', orderId);
      actor.assertCan(Permission.OrdersManage, order.branchId);
      if (!(await this.schedule.execute(order.id, order.branchId))) {
        throw new ConflictError('courier.no_active_dispatch', 'There is no active courier dispatch for the order');
      }
      await this.audit.record({ action: 'order.courier_cancel_requested', entityType: 'order', entityId: order.id, branchId: order.branchId });
    });
  }
}

