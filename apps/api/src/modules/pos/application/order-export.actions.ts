import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Config } from '../../../shared/infrastructure/config/config';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus, JobQueue } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { DEFAULT_TIMEZONE } from '../../../shared/kernel/time';
import { BranchDirectory } from '../../identity/public';
import { OrderQuery, OrderStatus } from '../../ordering/public';
import { cancelledAfterSentAlert, exportFailureAlert, unconfirmedOrderAlert } from '../domain/alert-texts';
import { describeMissing, resolveOrderLines } from '../domain/order-lines';
import { CONFIRM_MAX_CHECKS, MissingMapping, OrderExport, OrderExportState, PUSH_MAX_ATTEMPTS, SkipReason } from '../domain/order-export';
import { PosOrderCheck } from '../domain/pos-client';
import { OrderExportRecord, OrderExportRepository } from '../infrastructure/order-export.repository';
import { ProductMappingRepository } from '../infrastructure/product-mapping.repository';
import { OrderPosFailedPayload, OrderSentToPosPayload, PosEvents } from '../public';
import { AlertPosStaff } from './alert-pos-staff.action';
import { assertCanOperatePos } from './pos-access';
import { PosClientRegistry, ResolvedPosClient } from './pos-client.registry';
import { classifyPosError, ClassifiedPosError } from './pos-errors';

/** Задача передачи заказа в POS. */
export const PUSH_ORDER_JOB = 'pos.push_order';
export interface PushOrderJobPayload {
  orderId: string;
}

/**
 * Повторы передачи: экспоненциальная задержка 30 с, 1, 2, 4, 8 минут (потолок 15 минут).
 * Лимит очереди больше доменного: решение «попытки исчерпаны» принимает домен (PUSH_MAX_ATTEMPTS),
 * очередь неудач платформы — только для непредвиденных сбоев самого обработчика.
 */
export const PUSH_ORDER_RETRY = { attempts: PUSH_MAX_ATTEMPTS + 2, backoffMs: 30_000, maxBackoffMs: 15 * 60_000 };

/** Задача проверки заказа, который POS создаёт асинхронно. */
export const CONFIRM_ORDER_JOB = 'pos.confirm_order';
export interface ConfirmOrderJobPayload {
  orderId: string;
}
/** Первая проверка — через 30 с после передачи, дальше 30 с, 1, 2, 4, 5 минут (~13 минут всего). */
export const CONFIRM_ORDER_DELAY_MS = 30_000;
export const CONFIRM_ORDER_RETRY = { attempts: CONFIRM_MAX_CHECKS + 2, backoffMs: 30_000, maxBackoffMs: 5 * 60_000 };

/** Статусы заказа, в которых заказ передаётся в POS (кухня/выдача/учёт продажи). */
const PUSHABLE_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['accepted', 'cooking', 'ready', 'delivering', 'completed']);
const CANCELLED_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>(['cancelled', 'refunded']);

/** Провайдер, если маршрутизация не читается (ошибка настройки): задача всё равно запустится и сообщит об ошибке. */
const UNRESOLVED_PROVIDER = 'unknown';

function auditView(s: OrderExportState) {
  return {
    status: s.status,
    provider: s.provider,
    posOrderId: s.posOrderId,
    attempts: s.attempts,
    failureReason: s.failureReason,
    skipReason: s.skipReason,
    lastError: s.lastError,
    confirmedAt: s.confirmedAt,
  };
}

function adminOrderLink(config: Config, orderId: string): string {
  return `${config.app.adminUrl}/orders/${orderId}`;
}

/** Ожидание подтверждения от POS: задача проверки повторяется очередью с задержкой. */
class PosConfirmationPendingError extends Error {
  constructor(orderId: string) {
    super(`POS has not confirmed order ${orderId} yet`);
    this.name = 'PosConfirmationPendingError';
  }
}

/**
 * Заказ принят -> запись передачи + задача в очереди. Выполняется в обработчике события
 * (после коммита приёма заказа): приём заказа от POS не зависит.
 */
@Injectable()
export class RegisterOrderExport {
  constructor(
    private readonly exports: OrderExportRepository,
    private readonly registry: PosClientRegistry,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(input: { orderId: string; number: string; branchId: string }): Promise<void> {
    await this.database.transaction(async () => {
      if (await this.exports.findByOrderId(input.orderId)) return;
      const provider = await this.registry.providerFor(input.branchId).catch(() => UNRESOLVED_PROVIDER);
      const exp = OrderExport.create({
        id: newId(),
        orderId: input.orderId,
        orderNumber: input.number,
        branchId: input.branchId,
        provider,
        now: this.clock.now(),
      });
      if (await this.exports.insertIfAbsent(exp)) {
        await this.jobs.enqueue<PushOrderJobPayload>(PUSH_ORDER_JOB, { orderId: input.orderId }, { branchId: input.branchId, aggregateId: input.orderId });
      }
    });
  }
}

/**
 * Неудача передачи (в транзакции изменения записи): событие OrderPosFailed и оповещение персонала
 * филиала (WhatsApp/Telegram + лента админки). Сам заказ не меняется — кухня работает по экрану админки.
 */
@Injectable()
export class ReportOrderExportFailure {
  constructor(
    private readonly events: EventBus,
    private readonly alert: AlertPosStaff,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  async execute(s: OrderExportState): Promise<void> {
    const reason = s.failureReason ?? 'rejected';
    await this.events.publish<OrderPosFailedPayload>(
      PosEvents.OrderPosFailed,
      {
        orderId: s.orderId,
        number: s.orderNumber,
        branchId: s.branchId,
        provider: s.provider,
        reason,
        error: s.lastError ?? '',
        attempts: s.attempts,
        occurredAt: this.clock.now().toISOString(),
      },
      { aggregateId: s.orderId, branchId: s.branchId },
    );
    const text = exportFailureAlert({
      orderNumber: s.orderNumber,
      reason,
      error: s.lastError ?? '',
      attempts: s.attempts,
      missing: s.details.missing,
      link: adminOrderLink(this.config, s.orderId),
    });
    await this.alert.execute({
      branchId: s.branchId,
      ...text,
      dedupeKey: `pos:order:${s.orderId}:failed:${s.manualRetries}`,
      feed: { stream: 'orders', entityId: s.orderId },
      related: { type: 'order', id: s.orderId },
    });
  }
}

type PushOutcome =
  | { kind: 'sent'; posOrderId: string; confirmed: boolean }
  | { kind: 'skip'; reason: SkipReason }
  | { kind: 'fail'; error: ClassifiedPosError; missing?: MissingMapping[] }
  | { kind: 'temporary'; error: ClassifiedPosError; cause: unknown };

/**
 * Передача заказа в POS (фоновая задача). Идемпотентна: работает только с записью в статусе pending.
 * POS недоступна -> повтор с задержкой; попытки исчерпаны, нет сопоставления, POS отклонила,
 * не настроено -> failed, событие OrderPosFailed и оповещение персонала. Заказ при этом не меняется.
 */
@Injectable()
export class PushOrderToPos {
  private readonly logger = new Logger(PushOrderToPos.name);

  constructor(
    private readonly exports: OrderExportRepository,
    private readonly mappings: ProductMappingRepository,
    private readonly registry: PosClientRegistry,
    private readonly orders: OrderQuery,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly jobs: JobQueue,
    private readonly audit: AuditLog,
    private readonly reportFailure: ReportOrderExportFailure,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string): Promise<void> {
    const current = await this.exports.findByOrderId(orderId);
    if (!current || !current.isPending()) return;
    const branchId = current.snapshot().branchId;

    let resolved: ResolvedPosClient;
    try {
      resolved = await this.registry.resolve(branchId);
    } catch (err) {
      await this.apply(orderId, null, { kind: 'fail', error: classifyPosError(err) });
      return;
    }
    if (!resolved.client.capabilities.pushOrders) {
      await this.apply(orderId, resolved.provider, { kind: 'skip', reason: 'manual_provider' });
      return;
    }

    const started = await this.database.transaction(async () => {
      const exp = await this.exports.findByOrderId(orderId, { forUpdate: true });
      if (!exp || !exp.isPending()) return false;
      exp.useProvider(resolved.provider);
      exp.startAttempt(this.clock.now());
      await this.exports.save(exp);
      return true;
    });
    if (!started) return;

    const outcome = await this.attempt(orderId, branchId, resolved);
    await this.apply(orderId, resolved.provider, outcome);
  }

  private async attempt(orderId: string, branchId: string, resolved: ResolvedPosClient): Promise<PushOutcome> {
    try {
      const order = await this.orders.getKitchenOrder(orderId);
      if (CANCELLED_STATUSES.has(order.status)) return { kind: 'skip', reason: 'order_cancelled' };
      if (!PUSHABLE_STATUSES.has(order.status)) return { kind: 'skip', reason: 'order_not_accepted' };
      const mappings = await this.mappings.forDishes(
        branchId,
        resolved.provider,
        order.items.map((i) => i.dishId),
      );
      const { lines, missing } = resolveOrderLines(order.items, mappings);
      if (missing.length > 0) {
        return {
          kind: 'fail',
          error: { retryable: false, reason: 'missing_mapping', message: `Нет сопоставления с товарами POS: ${describeMissing(missing)}` },
          missing,
        };
      }
      const branch = await this.branches.find(branchId);
      const result = await resolved.client.pushOrder(order, { lines, timezone: branch?.timezone ?? DEFAULT_TIMEZONE });
      return { kind: 'sent', posOrderId: result.posOrderId, confirmed: result.confirmed ?? true };
    } catch (err) {
      const error = classifyPosError(err);
      return error.retryable ? { kind: 'temporary', error, cause: err } : { kind: 'fail', error };
    }
  }

  /** Применить результат попытки (под блокировкой записи). Временная неудача — повтор через очередь. */
  private async apply(orderId: string, provider: string | null, outcome: PushOutcome): Promise<void> {
    const retryCause = await this.database.transaction(async () => {
      const exp = await this.exports.findByOrderId(orderId, { forUpdate: true });
      if (!exp || !exp.isPending()) return null;
      if (provider) exp.useProvider(provider);
      const before = exp.snapshot();
      const now = this.clock.now();
      let cause: unknown = null;
      switch (outcome.kind) {
        case 'sent':
          exp.markSent(outcome.posOrderId, now, outcome.confirmed);
          break;
        case 'skip':
          exp.markSkipped(outcome.reason, now);
          break;
        case 'fail':
          exp.markFailed(outcome.error.reason, outcome.error.message, now, outcome.missing ? { missing: outcome.missing } : {});
          break;
        case 'temporary':
          if (exp.recordTemporaryFailure(outcome.error.message, now) === 'retry') cause = outcome.cause;
          break;
      }
      await this.exports.save(exp);
      const after = exp.snapshot();
      if (after.status !== before.status) {
        await this.audit.record({
          action: `pos.order_export_${after.status}`,
          entityType: 'pos_order_export',
          entityId: after.id,
          branchId: after.branchId,
          before: auditView(before),
          after: auditView(after),
          meta: { orderId: after.orderId, orderNumber: after.orderNumber },
        });
      }
      if (after.status === 'sent') {
        await this.events.publish<OrderSentToPosPayload>(
          PosEvents.OrderSentToPos,
          { orderId: after.orderId, branchId: after.branchId, posOrderId: after.posOrderId!, provider: after.provider, occurredAt: now.toISOString() },
          { aggregateId: after.orderId, branchId: after.branchId },
        );
        if (exp.needsConfirmation()) {
          await this.jobs.enqueue<ConfirmOrderJobPayload>(
            CONFIRM_ORDER_JOB,
            { orderId: after.orderId },
            { delayMs: CONFIRM_ORDER_DELAY_MS, branchId: after.branchId, aggregateId: after.orderId },
          );
        }
      }
      if (after.status === 'failed') await this.reportFailure.execute(after);
      return cause;
    });
    if (retryCause) {
      this.logger.warn({ orderId, err: retryCause instanceof Error ? retryCause.message : String(retryCause) }, 'POS push failed, will retry');
      throw retryCause;
    }
  }
}

/**
 * Проверка заказа, который POS создаёт асинхронно (фоновая задача): создан — подтверждение;
 * отклонён — sent -> failed, OrderPosFailed и оповещение; нет ответа за ~13 минут — персонал
 * просят проверить кассу. Ошибка самой проверки — повтор позже.
 */
@Injectable()
export class ConfirmPosOrder {
  private readonly logger = new Logger(ConfirmPosOrder.name);

  constructor(
    private readonly exports: OrderExportRepository,
    private readonly registry: PosClientRegistry,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly reportFailure: ReportOrderExportFailure,
    private readonly alert: AlertPosStaff,
    private readonly config: Config,
    private readonly clock: Clock,
  ) {}

  async execute(orderId: string): Promise<void> {
    const current = await this.exports.findByOrderId(orderId);
    if (!current || !current.needsConfirmation()) return;
    const s = current.snapshot();
    let check: PosOrderCheck | { state: 'in_progress'; error: string };
    try {
      // Проверяем в той POS, куда заказ передан (маршрутизацию могли поменять после передачи).
      check = await this.registry.get(s.provider).checkOrder({ branchId: s.branchId }, s.posOrderId!);
    } catch (err) {
      check = { state: 'in_progress', error: classifyPosError(err).message };
    }

    const wait = await this.database.transaction(async () => {
      const exp = await this.exports.findByOrderId(orderId, { forUpdate: true });
      if (!exp || !exp.needsConfirmation()) return false;
      const before = exp.snapshot();
      const outcome = exp.recordConfirmation(check, this.clock.now());
      await this.exports.save(exp);
      const after = exp.snapshot();
      if (outcome === 'rejected') {
        await this.audit.record({
          action: 'pos.order_export_failed',
          entityType: 'pos_order_export',
          entityId: after.id,
          branchId: after.branchId,
          before: auditView(before),
          after: auditView(after),
          meta: { orderId: after.orderId, orderNumber: after.orderNumber, stage: 'confirmation' },
        });
        await this.reportFailure.execute(after);
      }
      if (outcome === 'gave_up') {
        await this.alert.execute({
          branchId: after.branchId,
          ...unconfirmedOrderAlert({ orderNumber: after.orderNumber, posOrderId: after.posOrderId, link: adminOrderLink(this.config, after.orderId) }),
          dedupeKey: `pos:order:${after.orderId}:unconfirmed:${after.manualRetries}`,
          feed: { stream: 'orders', entityId: after.orderId },
          related: { type: 'order', id: after.orderId },
        });
      }
      return outcome === 'wait';
    });
    if (wait) {
      this.logger.debug({ orderId }, 'POS has not confirmed the order yet');
      throw new PosConfirmationPendingError(orderId);
    }
  }
}

/** Ручной повтор передачи из админки (после исправления сопоставления или настройки). */
@Injectable()
export class RetryOrderExport {
  constructor(
    private readonly exports: OrderExportRepository,
    private readonly jobs: JobQueue,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, exportId: string): Promise<OrderExportRecord> {
    const found = await this.exports.findById(exportId);
    if (!found) throw new NotFoundError('pos_order_export', exportId);
    const { branchId, orderId } = found.snapshot();
    assertCanOperatePos(actor, branchId);
    await this.database.transaction(async () => {
      const exp = await this.exports.findByOrderId(orderId, { forUpdate: true });
      if (!exp) throw new NotFoundError('pos_order_export', exportId);
      const before = exp.snapshot();
      exp.retry();
      await this.exports.save(exp);
      await this.audit.record({
        action: 'pos.order_export_retried',
        entityType: 'pos_order_export',
        entityId: exportId,
        branchId,
        before: auditView(before),
        after: auditView(exp.snapshot()),
        meta: { orderId, orderNumber: before.orderNumber },
      });
      await this.jobs.enqueue<PushOrderJobPayload>(PUSH_ORDER_JOB, { orderId }, { branchId, aggregateId: orderId });
    });
    return (await this.exports.getRecord(exportId))!;
  }
}

/**
 * Заказ отменён: если он уже передан в POS — персонал оповещается (отменить в POS вручную).
 * Если передача ещё не выполнена — задача увидит отмену и пропустит заказ.
 */
@Injectable()
export class HandleCancelledOrder {
  constructor(
    private readonly exports: OrderExportRepository,
    private readonly alert: AlertPosStaff,
    private readonly config: Config,
  ) {}

  async execute(input: { orderId: string }): Promise<void> {
    const exp = await this.exports.findByOrderId(input.orderId);
    if (!exp || exp.status !== 'sent') return;
    const s = exp.snapshot();
    const text = cancelledAfterSentAlert({ orderNumber: s.orderNumber, posOrderId: s.posOrderId, link: adminOrderLink(this.config, s.orderId) });
    await this.alert.execute({
      branchId: s.branchId,
      ...text,
      dedupeKey: `pos:order:${s.orderId}:cancelled_after_sent`,
      feed: { stream: 'orders', entityId: s.orderId },
      related: { type: 'order', id: s.orderId },
    });
  }
}
