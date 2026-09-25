import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { mergeSettings, ReservationSettings } from '../domain/settings';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';

/**
 * Настройки бронирования филиала (напоминание за N часов, упреждение и горизонт брони на витрине,
 * текст правил). Право venues.manage в филиале; изменение — в журнал действий.
 */
@Injectable()
export class UpdateReservationSettings {
  constructor(
    private readonly settings: ReservationSettingsRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, branchId: string, patch: Partial<ReservationSettings>): Promise<ReservationSettings> {
    actor.assertCan(Permission.VenuesManage, branchId);
    if (!(await this.branches.find(branchId))) throw new NotFoundError('branch', branchId);
    return this.database.transaction(async () => {
      const current = await this.settings.get(branchId);
      const next = mergeSettings(current, patch);
      await this.settings.upsert(branchId, next, actor.userId);
      await this.audit.record({
        action: 'reservation.settings_updated',
        entityType: 'reservation_settings',
        entityId: branchId,
        branchId,
        before: current,
        after: next,
        actor,
      });
      return next;
    });
  }
}
