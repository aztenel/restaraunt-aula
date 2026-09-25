import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { DiscoveryService } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BanquetEvents } from '../../src/modules/banquet/public';
import { BanquetJobs } from '../../src/modules/banquet/application/document.actions';
import { CatalogEvents } from '../../src/modules/catalog/public';
import { CustomersEvents } from '../../src/modules/customers/public';
import { IdentityEvents } from '../../src/modules/identity/public';
import { DELIVER_JOB } from '../../src/modules/notifications/application/queue-notification.action';
import { CourierJobs } from '../../src/modules/ordering/application/courier-requests';
import { AUTO_CANCEL_SCHEDULE } from '../../src/modules/ordering/application/auto-cancel-unpaid-orders.action';
import { OrderingEvents } from '../../src/modules/ordering/public';
import { PaymentJobs } from '../../src/modules/payments/application/create-payment.action';
import { PaymentsEvents } from '../../src/modules/payments/public';
import { CONFIRM_ORDER_JOB, PUSH_ORDER_JOB } from '../../src/modules/pos/application/order-export.actions';
import { IMPORT_PRODUCTS_JOB } from '../../src/modules/pos/application/product-import.actions';
import { SYNC_STOP_LIST_JOB } from '../../src/modules/pos/application/stop-list.actions';
import { PosEvents } from '../../src/modules/pos/public';
import { AccountingJobs } from '../../src/modules/reporting/application/accounting/accounting-export.actions';
import { ReportingEvents } from '../../src/modules/reporting/public';
import { ReservationJobs } from '../../src/modules/reservation/application/reservation-reminders';
import { ReservationEvents } from '../../src/modules/reservation/public';
import { PLATFORM_JOB_FAILED_EVENT } from '../../src/shared/infrastructure/events/handler-executor';
import { HandlerRegistry } from '../../src/shared/infrastructure/events/handler-registry';
import { createE2eApp, E2eContext, pendingOutbox } from './support/e2e-app';

/** Контракты событий модулей: константа → модуль-владелец (публикует только он). */
const CONTRACTS: Array<{ owner: string; name: string; events: Record<string, string> }> = [
  { owner: 'identity', name: 'IdentityEvents', events: IdentityEvents },
  { owner: 'catalog', name: 'CatalogEvents', events: CatalogEvents },
  { owner: 'customers', name: 'CustomersEvents', events: CustomersEvents },
  { owner: 'payments', name: 'PaymentsEvents', events: PaymentsEvents },
  { owner: 'ordering', name: 'OrderingEvents', events: OrderingEvents },
  { owner: 'reservation', name: 'ReservationEvents', events: ReservationEvents },
  { owner: 'banquet', name: 'BanquetEvents', events: BanquetEvents },
  { owner: 'pos', name: 'PosEvents', events: PosEvents },
  { owner: 'reporting', name: 'ReportingEvents', events: ReportingEvents },
];

/**
 * Кто из модулей обязан подписаться на событие (ТЗ, docs/decisions.md и описания контрактов в public/index.ts).
 * Имя модуля — Nest-модуль, в котором зарегистрирован класс-обработчик.
 */
const DOCUMENTED_CONSUMERS: Record<string, string[]> = {
  // Платежи: заказ (paid/поздняя оплата), депозит брони, счёт банкета, выпуск сертификата, поступления.
  [PaymentsEvents.PaymentSucceeded]: ['OrderingModule', 'ReservationModule', 'BanquetModule', 'PaymentsModule', 'ReportingModule'],
  [PaymentsEvents.PaymentFailed]: ['PaymentsModule'],
  [PaymentsEvents.PaymentCancelled]: ['PaymentsModule'],
  [PaymentsEvents.RefundSucceeded]: ['OrderingModule', 'ReservationModule', 'BanquetModule', 'PaymentsModule', 'CustomersModule', 'ReportingModule'],
  [PaymentsEvents.RefundFailed]: ['OrderingModule', 'ReservationModule'],
  [PaymentsEvents.CertificateIssued]: ['CustomersModule', 'ReportingModule'],
  [PaymentsEvents.CertificateRedeemed]: ['ReportingModule'],
  [PaymentsEvents.CertificateCredited]: ['ReportingModule'],
  [PaymentsEvents.CertificateExpired]: ['ReportingModule'],
  [PaymentsEvents.CertificateReinstated]: ['ReportingModule'],
  // Заказы: история гостя, отчётность, передача на кухню (POS).
  [OrderingEvents.OrderPlaced]: ['CustomersModule', 'ReportingModule'],
  [OrderingEvents.OrderStatusChanged]: ['ReportingModule', 'PosModule'],
  [OrderingEvents.OrderCompleted]: ['CustomersModule', 'ReportingModule'],
  [OrderingEvents.OrderCancelled]: ['CustomersModule', 'ReportingModule', 'PosModule'],
  // Брони: история гостя, загрузка залов.
  [ReservationEvents.ReservationCreated]: ['CustomersModule', 'ReportingModule'],
  [ReservationEvents.ReservationStatusChanged]: ['CustomersModule', 'ReportingModule'],
  [ReservationEvents.ReservationRescheduled]: ['ReportingModule'],
  // Банкеты: история гостя (теги banquet/corporate), воронка и выручка.
  [BanquetEvents.RequestCreated]: ['CustomersModule', 'ReportingModule'],
  [BanquetEvents.StatusChanged]: ['CustomersModule', 'ReportingModule'],
  [BanquetEvents.RequestAssigned]: ['ReportingModule'],
  [BanquetEvents.InvoiceIssued]: ['CustomersModule', 'ReportingModule'],
  [BanquetEvents.InvoicePaymentRecorded]: ['ReportingModule'],
  [BanquetEvents.ActIssued]: ['ReportingModule'],
  // Обезличивание гостя: модули, хранящие снимки контактов.
  [CustomersEvents.CustomerAnonymized]: ['OrderingModule', 'ReservationModule', 'BanquetModule'],
  [IdentityEvents.BranchChanged]: ['IdentityModule'],
  // Очередь неудач → оповещение администраторов и системная лента.
  [PLATFORM_JOB_FAILED_EVENT]: ['NotificationsModule'],
};

/** Задачи, которые модули ставят в очередь (JobQueue.enqueue) — у каждой должен быть исполнитель. */
const ENQUEUED_JOBS = [
  ...Object.values(PaymentJobs),
  ...Object.values(CourierJobs),
  ...Object.values(BanquetJobs),
  ...Object.values(AccountingJobs),
  ...Object.values(ReservationJobs),
  DELIVER_JOB,
  PUSH_ORDER_JOB,
  CONFIRM_ORDER_JOB,
  IMPORT_PRODUCTS_JOB,
  SYNC_STOP_LIST_JOB,
];

/** Расписания, на которые опираются решения (автоотмена, SLA, истечение броней и платежей, дневной отчёт…). */
const REQUIRED_SCHEDULES = [
  AUTO_CANCEL_SCHEDULE,
  'banquet.sla_check',
  'reservation.expire_holds',
  'payments.expire_pending',
  'payments.poll_pending',
  'payments.certificates_expire',
  'reporting.daily_report',
  'notifications.purge_secrets',
  'catalog.stop_list_auto_restore',
  'pos.sync_stop_lists',
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) acc.push(full);
  }
  return acc;
}

describe('E2E: full application wiring (handlers, jobs, schedules, event contracts)', () => {
  let ctx: E2eContext;
  let registry: HandlerRegistry;

  beforeAll(async () => {
    ctx = await createE2eApp();
    await ctx.reset();
    registry = ctx.t.get(HandlerRegistry);
  });
  afterAll(async () => ctx?.close());

  /** Класс-обработчик → Nest-модуль, в котором он зарегистрирован. */
  function moduleOfHandlers(): Map<object, string> {
    const map = new Map<object, string>();
    for (const wrapper of ctx.t.get(DiscoveryService).getProviders()) {
      if (wrapper.instance && typeof wrapper.instance === 'object') map.set(wrapper.instance as object, wrapper.host?.metatype?.name ?? '?');
    }
    return map;
  }

  it('boots all real modules with seeds; the outbox drains completely', async () => {
    expect(ctx.seed.branches.greenline).toBeTruthy();
    expect(await pendingOutbox(ctx)).toEqual([]);
  });

  it('handler keys are unique across modules (idempotency keys cannot collide)', () => {
    const instancesByKey = new Map<string, Set<unknown>>();
    for (const type of registry.eventTypes()) {
      for (const h of registry.eventHandlers(type) as Array<{ key: string; instance?: unknown }>) {
        const set = instancesByKey.get(h.key) ?? new Set();
        set.add(h.instance);
        instancesByKey.set(h.key, set);
        // Один и тот же обработчик не зарегистрирован на событие дважды.
        expect(registry.eventHandlers(type).filter((x) => x.key === h.key)).toHaveLength(1);
      }
    }
    const duplicated = [...instancesByKey.entries()].filter(([, s]) => s.size > 1).map(([k]) => k);
    expect(duplicated).toEqual([]);
    // Класс-обработчик — один экземпляр во всём приложении (имена классов уникальны между модулями).
    const handlerClasses = new Map<string, Set<unknown>>();
    for (const set of instancesByKey.values()) {
      for (const instance of set) {
        const name = (instance as object).constructor.name;
        handlerClasses.set(name, (handlerClasses.get(name) ?? new Set()).add(instance));
      }
    }
    expect([...handlerClasses.entries()].filter(([, s]) => s.size > 1).map(([n]) => n)).toEqual([]);
    const jobNames = registry.allJobHandlers().map((j) => j.name);
    expect(new Set(jobNames).size).toBe(jobNames.length);
    const scheduleNames = registry.allSchedules().map((s) => s.name);
    expect(new Set(scheduleNames).size).toBe(scheduleNames.length);
  });

  it('every subscribed event type is a declared contract event (no naming drift)', () => {
    const declared = new Set<string>([PLATFORM_JOB_FAILED_EVENT, ...CONTRACTS.flatMap((c) => Object.values(c.events))]);
    const unknown = registry.eventTypes().filter((t) => !declared.has(t));
    expect(unknown).toEqual([]);
  });

  it('every documented consumer actually has a registered handler for the event', () => {
    const modules = moduleOfHandlers();
    const missing: string[] = [];
    for (const [type, consumers] of Object.entries(DOCUMENTED_CONSUMERS)) {
      const registered = new Set(registry.eventHandlers(type).map((h) => modules.get((h as { instance?: object }).instance!) ?? '?'));
      for (const consumer of consumers) if (!registered.has(consumer)) missing.push(`${type} → ${consumer}`);
    }
    expect(missing).toEqual([]);
  });

  it('every event of a public contract is published by its owner module (no dead contract events)', () => {
    const root = join(__dirname, '..', '..', 'src', 'modules');
    const unpublished: string[] = [];
    for (const contract of CONTRACTS) {
      const files = sourceFiles(join(root, contract.owner)).filter((f) => {
        const rel = relative(root, f).split(sep);
        return !rel.includes('public') && !rel.includes('testing') && !rel.includes('handlers');
      });
      const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');
      for (const key of Object.keys(contract.events)) {
        if (!new RegExp(`\\b${contract.name}\\.${key}\\b`).test(code)) unpublished.push(`${contract.name}.${key}`);
      }
    }
    expect(unpublished).toEqual([]);
  });

  it('every enqueued job has a job handler; required schedules are registered', () => {
    const jobs = new Set(registry.allJobHandlers().map((j) => j.name));
    expect(ENQUEUED_JOBS.filter((j) => !jobs.has(j))).toEqual([]);
    const schedules = new Set(registry.allSchedules().map((s) => s.name));
    expect(REQUIRED_SCHEDULES.filter((s) => !schedules.has(s))).toEqual([]);
  });

  it('all schedules run against the seeded database without errors', async () => {
    for (const schedule of registry.allSchedules()) {
      await expect(schedule.invoke(), schedule.name).resolves.not.toThrow();
    }
    await ctx.drain();
    expect(await pendingOutbox(ctx)).toEqual([]);
  });
});
