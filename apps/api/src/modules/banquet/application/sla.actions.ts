import { Injectable, Logger } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { StaffDirectory, StaffRole } from '../../identity/public';
import { AdminFeed, Notifier } from '../../notifications/public';
import { minutesSince, SLA_FIRST_RESPONSE_MINUTES } from '../domain/sla';
import { ActivityRepository } from '../infrastructure/activity.repository';
import { RequestRepository } from '../infrastructure/request.repository';
import { BanquetLinks } from './banquet-links';
import { BanquetSupport } from './banquet-support';

const SYSTEM = Actor.system('banquet.sla');

/**
 * Контроль SLA первого ответа (раз в минуту): новые заявки без ответа дольше 30 минут —
 * уведомление ответственному менеджеру и собственникам (один раз, отметка sla_breached_at),
 * запись в ленте заявки и в ленте админки. Метрика — в статистике SLA и отчётности.
 */
@Injectable()
export class CheckSlaBreaches {
  private readonly logger = new Logger(CheckSlaBreaches.name);

  constructor(
    private readonly requests: RequestRepository,
    private readonly activities: ActivityRepository,
    private readonly support: BanquetSupport,
    private readonly staff: StaffDirectory,
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
    private readonly links: BanquetLinks,
    private readonly database: Database,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const ids = await this.requests.slaCandidates(new Date(now.getTime() - SLA_FIRST_RESPONSE_MINUTES * 60_000));
    if (ids.length === 0) return 0;
    const owners = (await this.staff.withRole(StaffRole.Owner)).filter((m) => m.isActive).map((m) => m.id);
    let breached = 0;
    for (const id of ids) {
      try {
        const done = await this.database.transaction(async () => {
          const request = await this.support.load(id, { forUpdate: true });
          if (!request.isSlaBreached(now) || request.snapshot().slaBreachedAt) return false;
          request.markSlaBreached(now);
          await this.requests.save(request);
          const s = request.snapshot();
          const minutes = minutesSince(s.createdAt, now);
          const manager = await this.support.manager(s.managerId);
          await this.activities.add({ requestId: id, kind: 'sla_breach', data: { minutes, managerId: s.managerId }, actor: SYSTEM, at: now });
          await this.notifier.notifyStaff({
            audience: { branchId: s.branchId, userIds: [...new Set([s.managerId, ...owners])] },
            template: 'staff.banquet_sla_breach',
            params: { number: s.number, minutes: String(minutes), managerName: manager.name, adminUrl: this.links.admin(id) },
            dedupeKey: `banquet:${id}:sla_breach`,
            related: { type: 'banquet_request', id },
          });
          await this.feed.push({
            branchId: s.branchId,
            stream: 'banquets',
            kind: 'updated',
            entityId: id,
            title: `Заявка ${s.number} без ответа ${minutes} мин.`,
            sound: true,
          });
          return true;
        });
        if (done) breached += 1;
      } catch (err) {
        // Одна проблемная заявка не должна останавливать проверку остальных.
        this.logger.error({ err, requestId: id }, 'SLA check failed for banquet request');
      }
    }
    return breached;
  }
}
