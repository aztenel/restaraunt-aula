import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Clock } from '../../../shared/kernel/clock';
import { newId } from '../../../shared/kernel/ids';
import { isTerminalDispatchStatus } from '../domain/courier-dispatch';
import { Order } from '../domain/order';
import { CourierDispatchRepository } from '../infrastructure/courier-dispatch.repository';
import { CourierDispatchRegistry } from './courier-dispatch.registry';

/** Задачи работы со службой курьеров (внешние вызовы — только из задач). */
export const CourierJobs = {
  Create: 'ordering.courier_dispatch',
  Poll: 'ordering.courier_poll',
  Cancel: 'ordering.courier_cancel',
} as const;

export interface CourierJobPayload {
  dispatchId: string;
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 1000);
}

/**
 * Заявка на курьера для заказа доставки, ставшего «Готов». Свои курьеры — ничего не делаем (доставку
 * ведёт оператор). Внешняя служба — запись заявки + задача создания в очереди (в транзакции перехода).
 * Ошибка настройки маршрутизации не блокирует смену статуса заказа.
 */
@Injectable()
export class RequestCourierDispatch {
  private readonly logger = new Logger(RequestCourierDispatch.name);

  constructor(
    private readonly registry: CourierDispatchRegistry,
    private readonly dispatches: CourierDispatchRepository,
    private readonly jobs: JobQueue,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(order: Order): Promise<string | null> {
    if (order.type !== 'delivery') return null;
    let provider: string;
    let external: boolean;
    try {
      const dispatcher = await this.registry.resolve(order.branchId);
      provider = dispatcher.provider;
      external = dispatcher.external;
    } catch (err) {
      this.logger.warn({ orderId: order.id, err: errorMessage(err) }, 'Courier routing is misconfigured, falling back to own couriers');
      return null;
    }
    if (!external) return null;
    const latest = await this.dispatches.latestForOrder(order.id);
    if (latest && !isTerminalDispatchStatus(latest.status)) return latest.id;
    const id = newId();
    await this.dispatches.insert({ id, orderId: order.id, branchId: order.branchId, provider, requestedAt: this.clock.now() });
    await this.jobs.enqueue(CourierJobs.Create, { dispatchId: id } satisfies CourierJobPayload, { aggregateId: order.id, branchId: order.branchId });
    await this.audit.record({
      action: 'order.courier_requested',
      entityType: 'order',
      entityId: order.id,
      branchId: order.branchId,
      after: { dispatchId: id, provider },
    });
    return id;
  }
}

/** Поставить отмену активной заявки заказа в очередь (в транзакции вызывающего действия). */
@Injectable()
export class ScheduleCourierCancellation {
  constructor(
    private readonly dispatches: CourierDispatchRepository,
    private readonly jobs: JobQueue,
  ) {}

  async execute(orderId: string, branchId: string): Promise<boolean> {
    const latest = await this.dispatches.latestForOrder(orderId);
    if (!latest || isTerminalDispatchStatus(latest.status)) return false;
    await this.jobs.enqueue(CourierJobs.Cancel, { dispatchId: latest.id } satisfies CourierJobPayload, { aggregateId: orderId, branchId });
    return true;
  }
}
