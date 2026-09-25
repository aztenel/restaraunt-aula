import { Injectable } from '@nestjs/common';
import { Expression, SqlBool } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { DEFAULT_FEED_ENTITY_TYPES, FeedItem } from '../domain/feed';
import { AdminFeedEntityType, AdminFeedEvent, AdminFeedStream } from '../public';
import { NotificationsTables } from './notifications.tables';

/** Доступ сотрудника к потоку: 'all' — все филиалы (и события без филиала), список — только эти филиалы. */
export type FeedStreamScope = Partial<Record<AdminFeedStream, 'all' | string[]>>;

@Injectable()
export class FeedRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<NotificationsTables>();
  }

  async insert(item: { id: string; occurredAt: Date } & AdminFeedEvent & { sound: boolean }): Promise<void> {
    await this.db()
      .insertInto('notifications.admin_feed')
      .values({
        id: item.id,
        occurred_at: item.occurredAt,
        branch_id: item.branchId,
        stream: item.stream,
        kind: item.kind,
        entity_id: item.entityId,
        entity_type: item.entityType ?? null,
        title: item.title,
        sound: item.sound,
      })
      .execute();
  }

  /**
   * Недавние события, доступные по правам (фильтр по потокам и филиалам — в SQL).
   * after — событие-ориентир (id) или момент времени; результат по возрастанию времени.
   */
  async recent(scope: FeedStreamScope, options: { afterId?: string; since?: Date; limit: number }): Promise<FeedItem[]> {
    const streams = Object.entries(scope).filter(([, s]) => s === 'all' || (Array.isArray(s) && s.length > 0));
    if (streams.length === 0) return [];
    let q = this.db()
      .selectFrom('notifications.admin_feed')
      .selectAll()
      .where((eb) => {
        const conditions: Expression<SqlBool>[] = streams.map(([stream, branches]) =>
          branches === 'all'
            ? eb('stream', '=', stream)
            : eb.and([eb('stream', '=', stream), eb('branch_id', 'in', branches as string[])]),
        );
        return eb.or(conditions);
      });
    if (options.afterId) q = q.where('id', '>', options.afterId);
    if (options.since) q = q.where('occurred_at', '>', options.since);
    // Последние N (по убыванию), затем по возрастанию для воспроизведения в порядке событий.
    const rows = await q.orderBy('occurred_at', 'desc').orderBy('id', 'desc').limit(options.limit).execute();
    return rows.reverse().map((r) => ({
      id: r.id,
      occurredAt: r.occurred_at.toISOString(),
      branchId: r.branch_id,
      stream: r.stream as AdminFeedStream,
      kind: r.kind as AdminFeedEvent['kind'],
      entityId: r.entity_id,
      entityType: (r.entity_type as AdminFeedEntityType | null) ?? DEFAULT_FEED_ENTITY_TYPES[r.stream as AdminFeedStream] ?? null,
      title: r.title,
      sound: r.sound,
    }));
  }

  async exists(id: string): Promise<boolean> {
    const row = await this.db().selectFrom('notifications.admin_feed').select('id').where('id', '=', id).executeTakeFirst();
    return !!row;
  }

  async deleteOlderThan(before: Date): Promise<number> {
    const rows = await this.db().deleteFrom('notifications.admin_feed').where('occurred_at', '<', before).returning('id').execute();
    return rows.length;
  }
}

@Injectable()
export class ProviderEventRepository {
  constructor(private readonly database: Database) {}

  /** true — событие новое (записано), false — уже обрабатывалось. */
  async markProcessed(key: string): Promise<boolean> {
    const row = await this.database
      .db<NotificationsTables>()
      .insertInto('notifications.provider_events')
      .values({ key })
      .onConflict((oc) => oc.column('key').doNothing())
      .returning('key')
      .executeTakeFirst();
    return !!row;
  }
}
