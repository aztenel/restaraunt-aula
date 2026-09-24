import { Injectable, Module } from '@nestjs/common';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, TestApp } from '../../../../test/support/test-app';
import { Database } from '../database/database';
import { JobHandler, OnEvent } from './decorators';
import { EventBus, JobQueue } from './event-bus';
import { EventEnvelope, JobEnvelope } from './types';

const calls: string[] = [];
let failuresLeft = 0;

@Injectable()
class TestHandlers {
  constructor(private readonly jobs: JobQueue) {}

  @OnEvent('test.happened')
  async onHappened(event: EventEnvelope<{ n: number }>): Promise<void> {
    calls.push(`event:${event.payload.n}`);
    await this.jobs.enqueue('test.external_call', { n: event.payload.n });
  }

  @OnEvent('test.happened')
  async secondSubscriber(event: EventEnvelope<{ n: number }>): Promise<void> {
    calls.push(`second:${event.payload.n}`);
  }

  @JobHandler('test.external_call', { attempts: 3, backoffMs: 1000 })
  async external(job: JobEnvelope<{ n: number }>): Promise<void> {
    if (failuresLeft > 0) {
      failuresLeft--;
      throw new Error('provider unavailable');
    }
    calls.push(`job:${job.payload.n}`);
  }
}

@Module({ providers: [TestHandlers] })
class TestHandlersModule {}

describe('Outbox, events and jobs (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ imports: [TestHandlersModule], migrateModules: [] });
  });
  afterAll(async () => t.close());
  beforeEach(async () => {
    await t.reset();
    calls.length = 0;
    failuresLeft = 0;
  });

  it('delivers events to every subscriber once, only after commit', async () => {
    const db = t.get(Database);
    await expect(
      db.transaction(async () => {
        await t.get(EventBus).publish('test.happened', { n: 1 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await t.drain();
    expect(calls).toEqual([]);

    await db.transaction(() => t.get(EventBus).publish('test.happened', { n: 2 }));
    await t.drain();
    expect(calls.sort()).toEqual(['event:2', 'job:2', 'second:2']);
  });

  it('retries jobs with backoff and moves exhausted ones to the failed queue', async () => {
    failuresLeft = 10;
    await t.get(JobQueue).enqueue('test.external_call', { n: 7 });
    await t.drain();
    expect(calls).toEqual([]);
    // Повторы отложены: продвигаем время и снова обрабатываем.
    for (let i = 0; i < 3; i++) {
      t.clock.advance(60 * 60_000);
      await t.drain();
    }
    const failed = await sql<{ topic: string; attempts: number }>`select topic, attempts from platform.failed_jobs`.execute(
      t.database.rootConnection(),
    );
    expect(failed.rows).toEqual([{ topic: 'test.external_call', attempts: 3 }]);
  });

  it('succeeds after transient failures', async () => {
    failuresLeft = 1;
    await t.get(JobQueue).enqueue('test.external_call', { n: 9 });
    await t.drain();
    t.clock.advance(5_000);
    await t.drain();
    expect(calls).toEqual(['job:9']);
  });
});
