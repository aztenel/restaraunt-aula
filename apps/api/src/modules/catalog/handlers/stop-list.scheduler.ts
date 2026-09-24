import { Injectable, Logger } from '@nestjs/common';
import { Scheduled } from '../../../shared/infrastructure/events/decorators';
import { RestoreExpiredStops } from '../application/stop-list.actions';

export const STOP_LIST_RESTORE_SCHEDULE = 'catalog.stop_list_auto_restore';

/** Раз в минуту возвращает в продажу блюда, у которых истёк стоп «до». */
@Injectable()
export class StopListScheduler {
  private readonly logger = new Logger(StopListScheduler.name);

  constructor(private readonly restoreExpiredStops: RestoreExpiredStops) {}

  @Scheduled(STOP_LIST_RESTORE_SCHEDULE, { everyMs: 60_000 })
  async restoreExpired(): Promise<void> {
    const restored = await this.restoreExpiredStops.execute();
    if (restored > 0) this.logger.log({ restored }, 'Stop-list items restored automatically');
  }
}
