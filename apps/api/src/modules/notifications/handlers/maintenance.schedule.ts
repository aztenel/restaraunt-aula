import { Injectable } from '@nestjs/common';
import { Scheduled } from '../../../shared/infrastructure/events/decorators';
import { CleanupAdminFeed, PurgeMessageSecrets } from '../application/maintenance.actions';

/** Периодическое обслуживание: история ленты админки и секреты доставленных сообщений. */
@Injectable()
export class NotificationsMaintenance {
  constructor(
    private readonly cleanupFeed: CleanupAdminFeed,
    private readonly purgeSecrets: PurgeMessageSecrets,
  ) {}

  @Scheduled('notifications.feed_cleanup', { cron: '20 4 * * *' })
  async cleanupAdminFeed(): Promise<void> {
    await this.cleanupFeed.execute();
  }

  @Scheduled('notifications.purge_secrets', { cron: '*/10 * * * *' })
  async purgeMessageSecrets(): Promise<void> {
    await this.purgeSecrets.execute();
  }
}
