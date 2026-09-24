import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { ForbiddenError, ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';
import { FEED_STREAM_PERMISSIONS, FeedItem, visibleStreams } from '../domain/feed';
import { FeedRepository, FeedStreamScope } from '../infrastructure/feed.repository';

export const RECENT_DEFAULT_LIMIT = 100;
export const RECENT_MAX_LIMIT = 500;

/** Потоки ленты и филиалы, доступные сотруднику (для фильтрации истории в SQL). */
export function feedScopeFor(actor: Actor): FeedStreamScope {
  const scope: FeedStreamScope = {};
  for (const stream of visibleStreams(actor)) scope[stream] = actor.branchesWith(FEED_STREAM_PERMISSIONS[stream]);
  return scope;
}

/** Недавние события ленты для догрузки после переподключения (с учётом прав по потокам и филиалам). */
@Injectable()
export class FeedQueries {
  constructor(private readonly feed: FeedRepository) {}

  async recent(actor: Actor, input: { since?: string; limit?: number }): Promise<FeedItem[]> {
    if (visibleStreams(actor).length === 0) {
      throw new ForbiddenError('access.forbidden', 'No access to admin queues', { permissions: Object.values(FEED_STREAM_PERMISSIONS) });
    }
    const limit = Math.min(Math.max(input.limit ?? RECENT_DEFAULT_LIMIT, 1), RECENT_MAX_LIMIT);
    const since = input.since?.trim();
    if (!since) return this.feed.recent(feedScopeFor(actor), { limit });
    if (isUuid(since)) return this.feed.recent(feedScopeFor(actor), { afterId: since, limit });
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError('admin_feed.invalid_since', 'since must be an ISO date-time or a feed event id');
    }
    return this.feed.recent(feedScopeFor(actor), { since: date, limit });
  }
}
