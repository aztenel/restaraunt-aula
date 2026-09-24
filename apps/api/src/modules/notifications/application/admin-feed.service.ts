import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Clock } from '../../../shared/kernel/clock';
import { newId } from '../../../shared/kernel/ids';
import { FeedItem, normalizeFeedEvent } from '../domain/feed';
import { FeedHub } from '../infrastructure/feed-hub';
import { FeedRepository } from '../infrastructure/feed.repository';
import { AdminFeed, AdminFeedEvent } from '../public';

/**
 * Лента админки (реализация контракта AdminFeed). Событие публикуется только после коммита
 * транзакции вызывающего кода: запись в недавнюю историю (догрузка после переподключения) и рассылка
 * открытым SSE-соединениям (Redis pub/sub между процессами). Любая ошибка ленты только логируется —
 * бизнес-операция (приём заказа, брони) от неё не зависит.
 */
@Injectable()
export class AdminFeedService extends AdminFeed {
  private readonly logger = new Logger(AdminFeedService.name);

  constructor(
    private readonly database: Database,
    private readonly feed: FeedRepository,
    private readonly hub: FeedHub,
    private readonly clock: Clock,
  ) {
    super();
  }

  async push(event: AdminFeedEvent): Promise<void> {
    let normalized: ReturnType<typeof normalizeFeedEvent>;
    try {
      normalized = normalizeFeedEvent(event);
    } catch (err) {
      this.logger.error({ err, event }, 'Invalid admin feed event ignored');
      return;
    }
    const item: FeedItem = { ...normalized, id: newId(), occurredAt: this.clock.now().toISOString() };
    const publish = async () => {
      try {
        await this.feed.insert({ ...item, occurredAt: new Date(item.occurredAt) });
      } catch (err) {
        this.logger.error({ err, stream: item.stream, entityId: item.entityId }, 'Failed to store admin feed event');
      }
      this.hub.publish(item);
    };
    if (this.database.inTransaction()) {
      this.database.afterCommit(publish);
    } else {
      await publish();
    }
  }
}
