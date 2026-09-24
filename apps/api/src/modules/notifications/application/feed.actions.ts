import { Injectable } from '@nestjs/common';
import { SecretBox, safeEqual } from '../../../shared/infrastructure/crypto/secret-box';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ForbiddenError, UnauthenticatedError, ValidationError } from '../../../shared/kernel/errors';
import { isUuid } from '../../../shared/kernel/ids';
import { StaffDirectory } from '../../identity/public';
import {
  actorFromFeedClaims,
  decodeFeedTicket,
  encodeFeedTicket,
  FEED_STREAM_PERMISSIONS,
  FEED_TICKET_TTL_SECONDS,
  feedClaimsFor,
  FeedItem,
  visibleStreams,
} from '../domain/feed';
import { FeedRepository, FeedStreamScope } from '../infrastructure/feed.repository';

const RECENT_DEFAULT_LIMIT = 100;
const RECENT_MAX_LIMIT = 500;

function scopeFor(actor: Actor): FeedStreamScope {
  const scope: FeedStreamScope = {};
  for (const stream of visibleStreams(actor)) scope[stream] = actor.branchesWith(FEED_STREAM_PERMISSIONS[stream]);
  return scope;
}

function sign(box: SecretBox, payload: string): string {
  return box.hmac(`admin-feed:${payload}`);
}

/**
 * Билет для подключения к SSE-потоку ленты (EventSource не передаёт заголовок Authorization).
 * Короткоживущий, подписан ключом приложения, привязан к сотруднику и его правам на просмотр очередей.
 */
@Injectable()
export class IssueFeedTicket {
  constructor(
    private readonly box: SecretBox,
    private readonly clock: Clock,
  ) {}

  execute(actor: Actor): { ticket: string; expiresIn: number } {
    if (!actor.isStaff() || !actor.userId) throw new UnauthenticatedError();
    if (visibleStreams(actor).length === 0) {
      throw new ForbiddenError('access.forbidden', 'No access to admin queues', { permissions: Object.values(FEED_STREAM_PERMISSIONS) });
    }
    const expiresAt = Math.floor(this.clock.now().getTime() / 1000) + FEED_TICKET_TTL_SECONDS;
    const ticket = encodeFeedTicket(feedClaimsFor(actor, expiresAt), (payload) => sign(this.box, payload));
    return { ticket, expiresIn: FEED_TICKET_TTL_SECONDS };
  }
}

/**
 * Открытие SSE-потока по билету: проверка подписи, срока, что сотрудник активен;
 * догрузка пропущенных событий после Last-Event-ID (переподключение EventSource).
 */
@Injectable()
export class OpenFeedStream {
  constructor(
    private readonly box: SecretBox,
    private readonly clock: Clock,
    private readonly staff: StaffDirectory,
    private readonly feed: FeedRepository,
  ) {}

  async execute(ticket: string | undefined, lastEventId: string | undefined): Promise<{ actor: Actor; backlog: FeedItem[] }> {
    const claims = decodeFeedTicket(
      ticket ?? '',
      (payload, signature) => safeEqual(sign(this.box, payload), signature),
      Math.floor(this.clock.now().getTime() / 1000),
    );
    if (!claims) throw new UnauthenticatedError('admin_feed.invalid_ticket', 'Feed ticket is invalid or expired');
    const member = await this.staff.get(claims.userId);
    if (!member || !member.isActive) throw new UnauthenticatedError('admin_feed.invalid_ticket', 'User is not active');
    const actor = actorFromFeedClaims(claims);
    const backlog =
      lastEventId && isUuid(lastEventId) ? await this.feed.recent(scopeFor(actor), { afterId: lastEventId, limit: RECENT_MAX_LIMIT }) : [];
    return { actor, backlog };
  }
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
    if (!since) return this.feed.recent(scopeFor(actor), { limit });
    if (isUuid(since)) return this.feed.recent(scopeFor(actor), { afterId: since, limit });
    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      throw new ValidationError('admin_feed.invalid_since', 'since must be an ISO date-time or a feed event id');
    }
    return this.feed.recent(scopeFor(actor), { since: date, limit });
  }
}
