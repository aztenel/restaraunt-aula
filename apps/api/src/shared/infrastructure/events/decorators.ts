import { RetryPolicy } from './types';

export const ON_EVENT_METADATA = 'aula:on_event';
export const JOB_HANDLER_METADATA = 'aula:job_handler';
export const SCHEDULED_METADATA = 'aula:scheduled';

export interface JobHandlerOptions extends Partial<RetryPolicy> {}

export interface JobHandlerMetadata {
  name: string;
  options: JobHandlerOptions;
}

export type ScheduleSpec = { cron: string; timezone?: string } | { everyMs: number };

export interface ScheduledMetadata {
  name: string;
  spec: ScheduleSpec;
}

/**
 * Подписка метода на доменное событие другого (или своего) модуля.
 * Обработчик выполняется асинхронно, в транзакции, ровно один раз на событие (идемпотентно).
 * Внешние вызовы из обработчика запрещены — для них ставится задача JobQueue.
 */
export function OnEvent(...types: string[]): MethodDecorator {
  return (_target, _key, descriptor) => {
    const existing: string[] = Reflect.getMetadata(ON_EVENT_METADATA, descriptor.value as object) ?? [];
    Reflect.defineMetadata(ON_EVENT_METADATA, [...existing, ...types], descriptor.value as object);
    return descriptor;
  };
}

/**
 * Обработчик фоновой задачи (внешние API, рассылки, PDF). Выполняется с повторами
 * и экспоненциальной задержкой; после исчерпания попыток — в очередь неудач.
 * Имя задачи: '<модуль>.<действие>', например 'notifications.deliver'.
 */
export function JobHandler(name: string, options: JobHandlerOptions = {}): MethodDecorator {
  return (_target, _key, descriptor) => {
    Reflect.defineMetadata(JOB_HANDLER_METADATA, { name, options } satisfies JobHandlerMetadata, descriptor.value as object);
    return descriptor;
  };
}

/** Периодическая задача (cron в часовом поясе Asia/Almaty или интервал). */
export function Scheduled(name: string, spec: ScheduleSpec): MethodDecorator {
  return (_target, _key, descriptor) => {
    Reflect.defineMetadata(SCHEDULED_METADATA, { name, spec } satisfies ScheduledMetadata, descriptor.value as object);
    return descriptor;
  };
}
