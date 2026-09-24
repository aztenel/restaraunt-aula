import { DynamicModule, INestApplication, Provider, Type } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import TestAgent from 'supertest/lib/agent';
import { configureHttpApp } from '../../src/main';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { Config } from '../../src/shared/infrastructure/config/config';
import { Database } from '../../src/shared/infrastructure/database/database';
import { OutboxProcessor } from '../../src/shared/infrastructure/events/outbox-processor';
import { HandlerRegistry } from '../../src/shared/infrastructure/events/handler-registry';
import { PlatformModule } from '../../src/shared/infrastructure/platform.module';
import { RateLimiter } from '../../src/shared/infrastructure/rate-limit/rate-limiter';
import { Clock, FixedClock } from '../../src/shared/kernel/clock';
import { prepareTestDatabase, truncateAll } from './test-database';

export interface TestAppOptions {
  /** Доменные модули под тестом (IdentityModule подключается всегда). */
  imports?: Array<Type<unknown> | DynamicModule>;
  /** Модули, чьи миграции применить (identity — всегда). По умолчанию — все. */
  migrateModules?: string[];
  /** Заглушки публичных сервисов других модулей: { provide: MenuPricing, useValue: fake }. */
  providers?: Provider[];
  /** Начальное время (FixedClock). */
  now?: Date;
}

export interface TestApp {
  app: INestApplication;
  module: TestingModule;
  http: () => TestAgent;
  database: Database;
  clock: FixedClock;
  config: Config;
  /** Обработать outbox: события -> обработчики, задачи -> исполнители (рекурсивно). */
  drain: () => Promise<void>;
  /** Вызвать @Scheduled-задачу вручную. */
  runSchedule: (name: string) => Promise<void>;
  get: <T>(token: Type<T> | string | symbol | (abstract new (...args: any[]) => T)) => T;
  reset: () => Promise<void>;
  close: () => Promise<void>;
}

export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const config = new Config(process.env);
  const migrate = options.migrateModules ? ['identity', ...options.migrateModules] : undefined;
  await prepareTestDatabase(config.database.url, migrate);
  const clock = new FixedClock(options.now ?? new Date('2026-10-01T06:00:00.000Z'));

  const builder = Test.createTestingModule({
    imports: [PlatformModule.forRoot(config), IdentityModule, ...(options.imports ?? [])],
    providers: options.providers ?? [],
  })
    .overrideProvider(Clock)
    .useValue(clock);
  const module = await builder.compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: ['error', 'warn'] });
  configureHttpApp(app, config);
  await app.init();

  const database = app.get(Database);
  const processor = app.get(OutboxProcessor);
  const registry = app.get(HandlerRegistry);

  return {
    app,
    module,
    http: () => request(app.getHttpServer()),
    database,
    clock,
    config,
    drain: () => processor.drain(),
    runSchedule: async (name: string) => {
      const schedule = registry.schedule(name);
      if (!schedule) throw new Error(`Unknown schedule ${name}`);
      await schedule.invoke();
    },
    get: (token) => app.get(token as never),
    reset: async () => {
      await truncateAll(database.rootConnection());
      app.get(RateLimiter).clearMemory();
    },
    close: () => app.close(),
  };
}
