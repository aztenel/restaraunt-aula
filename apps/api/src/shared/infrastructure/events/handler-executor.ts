import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../kernel/clock';
import { newId } from '../../kernel/ids';
import { RequestContext } from '../context/request-context';
import { Database } from '../database/database';
import { HandlerRegistry } from './handler-registry';
import { EVENT_DELIVERY_TOPIC, EventDeliveryPayload, JobEnvelope } from './types';

export const PLATFORM_JOB_FAILED_EVENT = 'platform.job_failed';

export interface JobFailedPayload {
  failedJobId: string;
  kind: string;
  topic: string;
  handler: string | null;
  error: string;
  attempts: number;
}

/** Выполнение обработчиков событий и задач в системном контексте. Общий для inline и bullmq. */
@Injectable()
export class HandlerExecutor {
  private readonly logger = new Logger(HandlerExecutor.name);

  constructor(
    private readonly registry: HandlerRegistry,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  /**
   * Доставка события одному обработчику. В транзакции, с ключом идемпотентности:
   * повторная доставка того же события тому же обработчику ничего не меняет.
   */
  async deliverEvent(delivery: EventDeliveryPayload): Promise<'done' | 'duplicate' | 'missing'> {
    const handler = this.registry.eventHandler(delivery.event.type, delivery.handlerKey);
    if (!handler) {
      this.logger.warn({ delivery: delivery.handlerKey, type: delivery.event.type }, 'Event handler not found, skipping');
      return 'missing';
    }
    return RequestContext.runAsSystem(
      `event:${delivery.handlerKey}`,
      () =>
        this.database.transaction(async () => {
          const inserted = await this.database
            .db()
            .insertInto('platform.idempotency_keys')
            .values({ key: `evt:${delivery.event.id}:${delivery.handlerKey}` })
            .onConflict((oc) => oc.doNothing())
            .returning('key')
            .executeTakeFirst();
          if (!inserted) return 'duplicate' as const;
          await handler.invoke(delivery.event);
          return 'done' as const;
        }),
      delivery.event.meta.requestId ?? undefined,
    );
  }

  async runJob(envelope: JobEnvelope): Promise<void> {
    if (envelope.name === EVENT_DELIVERY_TOPIC) {
      await this.deliverEvent(envelope.payload as EventDeliveryPayload);
      return;
    }
    const handler = this.registry.jobHandler(envelope.name);
    if (!handler) {
      throw new Error(`No job handler registered for ${envelope.name}`);
    }
    await RequestContext.runAsSystem(`job:${envelope.name}`, () => handler.invoke(envelope), envelope.meta.requestId ?? undefined);
  }

  retryPolicyFor(topic: string) {
    return this.registry.jobHandler(topic)?.retry;
  }

  /** Запись в очередь неудач + событие для оповещения администратора. */
  async recordFailure(input: {
    kind: string;
    topic: string;
    handler: string | null;
    payload: unknown;
    error: unknown;
    attempts: number;
  }): Promise<string> {
    const id = newId();
    const message = input.error instanceof Error ? `${input.error.name}: ${input.error.message}` : String(input.error);
    await this.database.transaction(async () => {
      await this.database
        .db()
        .insertInto('platform.failed_jobs')
        .values({
          id,
          kind: input.kind,
          topic: input.topic,
          handler: input.handler,
          payload: JSON.stringify(input.payload),
          error: message.slice(0, 4000),
          attempts: input.attempts,
          failed_at: this.clock.now(),
        })
        .execute();
      // Событие о провале (кроме провалов самой доставки этого события — чтобы не зациклиться).
      const failedEventType =
        input.topic === EVENT_DELIVERY_TOPIC ? (input.payload as EventDeliveryPayload | undefined)?.event?.type : input.topic;
      if (failedEventType !== PLATFORM_JOB_FAILED_EVENT) {
        const envelope = {
          id: newId(),
          type: PLATFORM_JOB_FAILED_EVENT,
          occurredAt: this.clock.now().toISOString(),
          payload: {
            failedJobId: id,
            kind: input.kind,
            topic: input.topic,
            handler: input.handler,
            error: message.slice(0, 500),
            attempts: input.attempts,
          } satisfies JobFailedPayload,
          meta: {},
        };
        await this.database
          .db()
          .insertInto('platform.outbox')
          .values({
            id: envelope.id,
            kind: 'event',
            topic: PLATFORM_JOB_FAILED_EVENT,
            payload: JSON.stringify(envelope),
            meta: '{}',
            available_at: this.clock.now(),
          })
          .execute();
      }
    });
    this.logger.error({ failedJobId: id, topic: input.topic, handler: input.handler, err: message }, 'Job moved to failed queue');
    return id;
  }
}
