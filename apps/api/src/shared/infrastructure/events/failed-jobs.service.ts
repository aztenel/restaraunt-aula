import { Injectable } from '@nestjs/common';
import { Clock } from '../../kernel/clock';
import { NotFoundError } from '../../kernel/errors';
import { newId } from '../../kernel/ids';
import { offsetOf, Page, pageOf, PageRequest } from '../../kernel/pagination';
import { Database } from '../database/database';
import { EVENT_DELIVERY_TOPIC, EventDeliveryPayload, JobEnvelope } from './types';

export interface FailedJobView {
  id: string;
  kind: string;
  topic: string;
  handler: string | null;
  payload: unknown;
  error: string;
  attempts: number;
  failedAt: Date;
  retriedAt: Date | null;
  resolvedAt: Date | null;
}

/** Очередь неудач: просмотр, повтор, закрытие. Доступно администратору системы. */
@Injectable()
export class FailedJobsService {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async list(filter: { open?: boolean }, page: PageRequest): Promise<Page<FailedJobView>> {
    let q = this.database.db().selectFrom('platform.failed_jobs');
    if (filter.open) q = q.where('resolved_at', 'is', null);
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('failed_at', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(
      rows.map((r: any) => ({
        id: r.id,
        kind: r.kind,
        topic: r.topic,
        handler: r.handler,
        payload: r.payload,
        error: r.error,
        attempts: r.attempts,
        failedAt: r.failed_at,
        retriedAt: r.retried_at,
        resolvedAt: r.resolved_at,
      })),
      Number(total?.n ?? 0),
      page,
    );
  }

  async openCount(): Promise<number> {
    const row = await this.database
      .db()
      .selectFrom('platform.failed_jobs')
      .where('resolved_at', 'is', null)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** Повтор: задача снова ставится в outbox с обнулённым счётчиком попыток. */
  async retry(id: string, userId: string | null): Promise<void> {
    await this.database.transaction(async () => {
      const row: any = await this.database.db().selectFrom('platform.failed_jobs').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundError('failed_job', id);
      const isDelivery = row.kind === 'event';
      const envelope: JobEnvelope = {
        id: newId(),
        name: isDelivery ? EVENT_DELIVERY_TOPIC : row.topic,
        payload: isDelivery ? ({ ...(row.payload as EventDeliveryPayload), handlerKey: row.handler } as EventDeliveryPayload) : row.payload,
        enqueuedAt: this.clock.now().toISOString(),
        meta: {},
      };
      await this.database
        .db()
        .insertInto('platform.outbox')
        .values({
          id: envelope.id,
          kind: 'job',
          topic: envelope.name,
          payload: JSON.stringify(envelope),
          meta: '{}',
          available_at: this.clock.now(),
        })
        .execute();
      await this.database
        .db()
        .updateTable('platform.failed_jobs')
        .set({ retried_at: this.clock.now(), resolved_at: this.clock.now(), resolved_by: userId })
        .where('id', '=', id)
        .execute();
    });
  }

  async resolve(id: string, userId: string | null): Promise<void> {
    const res = await this.database
      .db()
      .updateTable('platform.failed_jobs')
      .set({ resolved_at: this.clock.now(), resolved_by: userId })
      .where('id', '=', id)
      .executeTakeFirst();
    if (Number(res.numUpdatedRows) === 0) throw new NotFoundError('failed_job', id);
  }
}
