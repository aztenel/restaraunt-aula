import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { FEED_RETENTION_DAYS } from '../domain/feed';
import { FeedRepository } from '../infrastructure/feed.repository';
import { MessageRepository } from '../infrastructure/message.repository';

/** Сколько хранится секрет сообщения после завершения доставки (асинхронная ошибка WhatsApp -> резерв SMS). */
export const SECRET_RETENTION_MINUTES = 60;

/** Удалить историю ленты админки старше срока хранения (догрузка нужна только после недолгого обрыва). */
@Injectable()
export class CleanupAdminFeed {
  private readonly logger = new Logger(CleanupAdminFeed.name);

  constructor(
    private readonly feed: FeedRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - FEED_RETENTION_DAYS * 24 * 3600_000);
    const deleted = await this.feed.deleteOlderThan(before);
    if (deleted > 0) this.logger.log({ deleted }, 'Admin feed history cleaned up');
    return deleted;
  }
}

/** Удалить зашифрованные коды (OTP, сертификаты) у сообщений, доставка которых давно завершена. */
@Injectable()
export class PurgeMessageSecrets {
  constructor(
    private readonly messages: MessageRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    return this.messages.purgeSecrets(new Date(this.clock.now().getTime() - SECRET_RETENTION_MINUTES * 60_000));
  }
}
