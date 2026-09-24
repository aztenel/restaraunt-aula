import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { sql } from 'kysely';
import { Client } from 'pg';
import { Clock } from '../../kernel/clock';
import { Config } from '../config/config';
import { RequestContext } from '../context/request-context';
import { Database } from '../database/database';
import { HandlerExecutor } from './handler-executor';
import { HandlerRegistry } from './handler-registry';
import { OutboxRow } from './outbox-processor';
import {
  backoffDelay,
  DEFAULT_RETRY,
  EVENT_DELIVERY_TOPIC,
  EventDeliveryPayload,
  EventEnvelope,
  JobEnvelope,
  RetryPolicy,
} from './types';

const EVENTS_QUEUE = 'events';
const SCHEDULES_QUEUE = 'schedules';

export function queueNameFor(topic: string): string {
  if (topic === EVENT_DELIVERY_TOPIC) return EVENTS_QUEUE;
  const prefix = topic.split('.')[0];
  return prefix && prefix.length > 0 ? prefix : 'default';
}

/**
 * Рантайм очередей для воркера (режим bullmq):
 * - relay: outbox -> BullMQ (просыпается по pg NOTIFY и раз в секунду для отложенных);
 * - воркеры по очередям модулей с повторами, экспоненциальной задержкой и очередью неудач;
 * - периодические задачи (@Scheduled) через job schedulers BullMQ.
 */
@Injectable()
export class BullmqRuntime implements OnApplicationShutdown {
  private readonly logger = new Logger(BullmqRuntime.name);
  private connection: IORedis | null = null;
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private listener: Client | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private relaying = false;
  private relayRequested = false;
  private stopped = false;

  constructor(
    private readonly config: Config,
    private readonly database: Database,
    private readonly registry: HandlerRegistry,
    private readonly executor: HandlerExecutor,
    private readonly clock: Clock,
  ) {}

  private redis(): IORedis {
    if (!this.connection) {
      this.connection = new IORedis(this.config.redis.url, { maxRetriesPerRequest: null });
    }
    return this.connection;
  }

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.redis(),
        prefix: this.config.queue.prefix,
        defaultJobOptions: {
          removeOnComplete: { age: 24 * 3600, count: 10_000 },
          removeOnFail: { age: 14 * 24 * 3600 },
        },
      });
      this.queues.set(name, q);
    }
    return q;
  }

  /** Запуск воркеров, relay и расписаний. Вызывается из worker.ts. */
  async start(options: { concurrency?: number } = {}): Promise<void> {
    const queueNames = new Set<string>([EVENTS_QUEUE]);
    for (const job of this.registry.allJobHandlers()) queueNames.add(queueNameFor(job.name));

    for (const name of queueNames) {
      const worker = new Worker(name, (job) => this.process(job), {
        connection: this.redis(),
        prefix: this.config.queue.prefix,
        concurrency: options.concurrency ?? 5,
        settings: {
          backoffStrategy: (attemptsMade: number, _type?: string, _err?: Error, job?: { name: string }) => {
            const policy = this.policyFor(job?.name ?? '');
            return backoffDelay(policy, attemptsMade);
          },
        },
      });
      worker.on('failed', (job, err) => void this.onFailed(job, err));
      worker.on('error', (err) => this.logger.error({ err }, `Worker ${name} error`));
      this.workers.push(worker);
    }

    await this.startSchedules();
    await this.startRelay();
    this.logger.log(`Queue runtime started: ${[...queueNames].join(', ')}`);
  }

  private policyFor(topic: string): RetryPolicy {
    return this.registry.jobHandler(topic)?.retry ?? DEFAULT_RETRY;
  }

  private async process(job: Job): Promise<void> {
    if (job.queueName === SCHEDULES_QUEUE) {
      const schedule = this.registry.schedule(job.name);
      if (!schedule) {
        this.logger.warn(`Unknown schedule ${job.name}`);
        return;
      }
      await RequestContext.runAsSystem(`schedule:${job.name}`, () => schedule.invoke());
      return;
    }
    await this.executor.runJob(job.data as JobEnvelope);
  }

  private async onFailed(job: Job | undefined, err: Error): Promise<void> {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < attempts) return;
    const envelope = job.data as JobEnvelope;
    const isDelivery = envelope?.name === EVENT_DELIVERY_TOPIC;
    try {
      await this.executor.recordFailure({
        kind: isDelivery ? 'event' : job.queueName === SCHEDULES_QUEUE ? 'schedule' : 'job',
        topic: envelope?.name ?? job.name,
        handler: isDelivery ? (envelope.payload as EventDeliveryPayload).handlerKey : (this.registry.jobHandler(job.name)?.key ?? null),
        payload: envelope?.payload ?? job.data,
        error: err,
        attempts: job.attemptsMade,
      });
    } catch (recordErr) {
      this.logger.error({ err: recordErr }, 'Failed to record failed job');
    }
  }

  private async startSchedules(): Promise<void> {
    const queue = this.queue(SCHEDULES_QUEUE);
    const worker = new Worker(SCHEDULES_QUEUE, (job) => this.process(job), {
      connection: this.redis(),
      prefix: this.config.queue.prefix,
      concurrency: 2,
    });
    worker.on('failed', (job, err) => void this.onFailed(job, err));
    this.workers.push(worker);
    const active = new Set<string>();
    for (const schedule of this.registry.allSchedules()) {
      active.add(schedule.name);
      const repeat =
        'cron' in schedule.spec
          ? { pattern: schedule.spec.cron, tz: schedule.spec.timezone ?? 'Asia/Almaty' }
          : { every: schedule.spec.everyMs };
      await queue.upsertJobScheduler(schedule.name, repeat, {
        name: schedule.name,
        data: {},
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
      });
    }
    // Удалить расписания, которых больше нет в коде.
    for (const existing of await queue.getJobSchedulers()) {
      if (existing.key && !active.has(existing.key)) {
        await queue.removeJobScheduler(existing.key);
      }
    }
  }

  private async startRelay(): Promise<void> {
    this.listener = new Client({ connectionString: this.config.database.url });
    await this.listener.connect();
    this.listener.on('notification', () => this.requestRelay());
    this.listener.on('error', (err) => this.logger.error({ err }, 'Outbox listener error'));
    await this.listener.query('LISTEN aula_outbox');
    this.pollTimer = setInterval(() => this.requestRelay(), 1_000);
    this.requestRelay();
  }

  private requestRelay(): void {
    if (this.stopped) return;
    if (this.relaying) {
      this.relayRequested = true;
      return;
    }
    this.relaying = true;
    void this.relayLoop().finally(() => {
      this.relaying = false;
      if (this.relayRequested) {
        this.relayRequested = false;
        this.requestRelay();
      }
    });
  }

  private async relayLoop(): Promise<void> {
    try {
      while (true) {
        const moved = await this.relayBatch(200);
        if (moved === 0) break;
      }
    } catch (err) {
      this.logger.error({ err }, 'Outbox relay failed');
    }
  }

  /** Перенести пачку готовых записей outbox в BullMQ. */
  async relayBatch(limit: number): Promise<number> {
    const now = this.clock.now();
    return this.database.transaction(async () => {
      const rows = await sql<OutboxRow>`
        select id, kind, topic, payload, attempts, available_at
        from platform.outbox
        where dispatched_at is null
        order by available_at, created_at
        limit ${limit}
        for update skip locked`.execute(this.database.db());
      for (const row of rows.rows) {
        if (row.kind === 'event') {
          const event = row.payload as EventEnvelope;
          for (const handler of this.registry.eventHandlers(event.type)) {
            const delivery: JobEnvelope<EventDeliveryPayload> = {
              id: `${event.id}:${handler.key}`,
              name: EVENT_DELIVERY_TOPIC,
              payload: { handlerKey: handler.key, event },
              enqueuedAt: now.toISOString(),
              meta: event.meta,
            };
            await this.queue(EVENTS_QUEUE).add(EVENT_DELIVERY_TOPIC, delivery, {
              jobId: delivery.id.replace(/:/g, '_'),
              attempts: DEFAULT_RETRY.attempts,
              backoff: { type: 'aula' },
            });
          }
        } else {
          const envelope = row.payload as JobEnvelope;
          const policy = this.policyFor(row.topic);
          const delay = Math.max(0, new Date(row.available_at).getTime() - now.getTime());
          await this.queue(queueNameFor(row.topic)).add(row.topic, envelope, {
            jobId: row.id,
            delay,
            attempts: policy.attempts,
            backoff: { type: 'aula' },
          });
        }
      }
      if (rows.rows.length > 0) {
        await this.database
          .db()
          .updateTable('platform.outbox')
          .set({ dispatched_at: now })
          .where(
            'id',
            'in',
            rows.rows.map((r) => r.id),
          )
          .execute();
      }
      return rows.rows.length;
    });
  }

  async queueCounts(): Promise<Record<string, Record<string, number>>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [name, queue] of this.queues) {
      result[name] = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
    }
    return result;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    if (this.listener) await this.listener.end().catch(() => undefined);
    if (this.connection) this.connection.disconnect();
  }
}
