import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  JOB_HANDLER_METADATA,
  JobHandlerMetadata,
  ON_EVENT_METADATA,
  SCHEDULED_METADATA,
  ScheduledMetadata,
  ScheduleSpec,
} from './decorators';
import { DEFAULT_RETRY, EventEnvelope, JobEnvelope, RetryPolicy } from './types';

export interface RegisteredEventHandler {
  key: string;
  type: string;
  invoke(event: EventEnvelope): Promise<void>;
}

export interface RegisteredJobHandler {
  key: string;
  name: string;
  retry: RetryPolicy;
  invoke(job: JobEnvelope): Promise<void>;
}

export interface RegisteredSchedule {
  key: string;
  name: string;
  spec: ScheduleSpec;
  invoke(): Promise<void>;
}

/** Находит все @OnEvent / @JobHandler / @Scheduled методы в провайдерах приложения. */
@Injectable()
export class HandlerRegistry implements OnModuleInit {
  private readonly events = new Map<string, RegisteredEventHandler[]>();
  private readonly eventsByKey = new Map<string, RegisteredEventHandler>();
  private readonly jobs = new Map<string, RegisteredJobHandler>();
  private readonly schedules = new Map<string, RegisteredSchedule>();
  private scanned = false;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  onModuleInit(): void {
    this.scan();
  }

  scan(): void {
    if (this.scanned) return;
    this.scanned = true;
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== 'object' || !wrapper.isDependencyTreeStatic()) continue;
      const proto = Object.getPrototypeOf(instance) as object;
      const className = instance.constructor?.name ?? 'Anonymous';
      for (const method of this.scanner.getAllMethodNames(proto)) {
        const fn = (proto as Record<string, unknown>)[method];
        if (typeof fn !== 'function') continue;
        const key = `${className}.${method}`;
        const eventTypes: string[] | undefined = Reflect.getMetadata(ON_EVENT_METADATA, fn);
        for (const type of eventTypes ?? []) {
          const handler: RegisteredEventHandler = {
            key,
            type,
            invoke: (event) => (fn as (e: EventEnvelope) => Promise<void>).call(instance, event),
          };
          if (this.eventsByKey.has(`${type}|${key}`)) continue;
          this.eventsByKey.set(`${type}|${key}`, handler);
          this.events.set(type, [...(this.events.get(type) ?? []), handler]);
        }
        const job: JobHandlerMetadata | undefined = Reflect.getMetadata(JOB_HANDLER_METADATA, fn);
        if (job) {
          if (this.jobs.has(job.name)) {
            throw new Error(`Duplicate job handler for ${job.name}: ${this.jobs.get(job.name)!.key} and ${key}`);
          }
          this.jobs.set(job.name, {
            key,
            name: job.name,
            retry: { ...DEFAULT_RETRY, ...job.options },
            invoke: (envelope) => (fn as (j: JobEnvelope) => Promise<void>).call(instance, envelope),
          });
        }
        const schedule: ScheduledMetadata | undefined = Reflect.getMetadata(SCHEDULED_METADATA, fn);
        if (schedule) {
          if (this.schedules.has(schedule.name)) {
            throw new Error(`Duplicate schedule ${schedule.name}`);
          }
          this.schedules.set(schedule.name, {
            key,
            name: schedule.name,
            spec: schedule.spec,
            invoke: () => (fn as () => Promise<void>).call(instance),
          });
        }
      }
    }
  }

  eventHandlers(type: string): RegisteredEventHandler[] {
    this.scan();
    return this.events.get(type) ?? [];
  }

  eventHandler(type: string, key: string): RegisteredEventHandler | undefined {
    this.scan();
    return this.eventsByKey.get(`${type}|${key}`);
  }

  jobHandler(name: string): RegisteredJobHandler | undefined {
    this.scan();
    return this.jobs.get(name);
  }

  allJobHandlers(): RegisteredJobHandler[] {
    this.scan();
    return [...this.jobs.values()];
  }

  allSchedules(): RegisteredSchedule[] {
    this.scan();
    return [...this.schedules.values()];
  }

  schedule(name: string): RegisteredSchedule | undefined {
    this.scan();
    return this.schedules.get(name);
  }

  eventTypes(): string[] {
    this.scan();
    return [...this.events.keys()];
  }
}
