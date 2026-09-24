import { Injectable, Logger } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import {
  displayAvailability,
  effectiveAvailability,
  endOfLocalDay,
  isStopExpired,
  restoreItem,
  StopListState,
  StopSource,
  stopItem,
} from '../domain/stop-list';
import { BranchMenuRepository } from '../infrastructure/branch-menu.repository';
import { CatalogEventPublisher } from './catalog-events';

export interface SetDishAvailabilityInput {
  branchId: string;
  dishId: string;
  available: boolean;
  /** Стоп «до» момента (автовозврат). Не задан — до ручного возврата. */
  until?: Date | null;
  /** Стоп до конца дня в часовом поясе филиала. */
  untilEndOfDay?: boolean | null;
  reason?: string | null;
  source: StopSource;
}

function stopView(state: StopListState) {
  return {
    availability: state.availability,
    stoppedUntil: state.stoppedUntil?.toISOString() ?? null,
    stopReason: state.stopReason,
    stopSource: state.stopSource,
  };
}

/**
 * Стоп-лист: блюдо в филиале ставится в стоп или возвращается в продажу (право menu.stoplist
 * в этом филиале). Повторное действие без изменений ничего не пишет (идемпотентно — важно для
 * синхронизации с POS). Пишется журнал и публикуются StopListChanged + MenuChanged.
 */
@Injectable()
export class SetDishAvailability {
  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: SetDishAvailabilityInput): Promise<{ changed: boolean }> {
    actor.assertCan(Permission.MenuStopList, input.branchId);
    const branch = await this.branches.find(input.branchId);
    if (!branch) throw new NotFoundError('branch', input.branchId);
    if (input.until && input.untilEndOfDay) {
      throw new ValidationError('catalog.stop_until_invalid', 'Use either "until" or "untilEndOfDay"');
    }
    return this.database.transaction(async () => {
      const item = await this.branchMenu.findForUpdate(input.branchId, input.dishId);
      if (!item) throw new NotFoundError('branch_menu_item', input.dishId, { branchId: input.branchId });
      const now = this.clock.now();
      const until = input.untilEndOfDay ? endOfLocalDay(now, branch.timezone) : (input.until ?? null);
      const change = input.available
        ? restoreItem(item)
        : stopItem(item, { until, reason: input.reason, source: input.source, now });
      if (!change.changed) return { changed: false };

      await this.branchMenu.updateStopState(item.id, change.state, actor.userId);
      await this.audit.record({
        action: 'menu.stop_list_changed',
        entityType: 'branch_dish_price',
        entityId: input.dishId,
        branchId: input.branchId,
        before: stopView(item),
        after: stopView(change.state),
        meta: { source: input.source },
        actor,
      });
      await this.events.stopListChanged({
        branchId: input.branchId,
        dishId: input.dishId,
        availability: displayAvailability(effectiveAvailability(change.state, now), branch.settings.stopListMode),
        source: input.source,
        stoppedUntil: change.state.stoppedUntil?.toISOString() ?? null,
        reason: change.state.stopReason,
      });
      await this.events.menuChanged({ branchId: input.branchId, dishId: input.dishId });
      return { changed: true };
    });
  }
}

/** Автоматический возврат блюд, у которых истёк стоп «до» (запускается по расписанию). */
@Injectable()
export class RestoreExpiredStops {
  private readonly logger = new Logger(RestoreExpiredStops.name);

  constructor(
    private readonly branchMenu: BranchMenuRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: CatalogEventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const actor = Actor.system('catalog.stop_list_auto_restore');
    let restored = 0;
    for (const candidate of await this.branchMenu.expiredStops(now)) {
      try {
        await this.database.transaction(async () => {
          const item = await this.branchMenu.findForUpdate(candidate.branchId, candidate.dishId);
          if (!item || !isStopExpired(item, now)) return;
          const change = restoreItem(item);
          await this.branchMenu.updateStopState(item.id, change.state, null);
          await this.audit.record({
            action: 'menu.stop_list_changed',
            entityType: 'branch_dish_price',
            entityId: item.dishId,
            branchId: item.branchId,
            before: stopView(item),
            after: stopView(change.state),
            meta: { source: item.stopSource, auto: true },
            actor,
          });
          await this.events.stopListChanged({
            branchId: item.branchId,
            dishId: item.dishId,
            availability: 'available',
            source: item.stopSource ?? 'manual',
            stoppedUntil: null,
            reason: null,
          });
          await this.events.menuChanged({ branchId: item.branchId, dishId: item.dishId });
          restored++;
        });
      } catch (err) {
        // Одна проблемная позиция не должна останавливать возврат остальных.
        this.logger.error({ err, branchId: candidate.branchId, dishId: candidate.dishId }, 'Stop-list auto-restore failed');
      }
    }
    return restored;
  }
}
