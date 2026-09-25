import { Injectable } from '@nestjs/common';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { DEFAULT_RESERVATION_SETTINGS, ReservationSettings } from '../domain/settings';
import { ReservationTables } from './reservation.tables';

/** Настройки бронирования филиала. Нет строки — действуют значения по умолчанию. */
@Injectable()
export class ReservationSettingsRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReservationTables>();
  }

  async find(branchId: string): Promise<(ReservationSettings & { updatedAt: Date | null; updatedBy: string | null }) | null> {
    const row = await this.db().selectFrom('reservation.branch_settings').selectAll().where('branch_id', '=', branchId).executeTakeFirst();
    if (!row) return null;
    return {
      reminderHoursBefore: row.reminder_hours_before,
      minLeadMinutes: row.min_lead_minutes,
      maxDaysAhead: row.max_days_ahead,
      policyText: (row.policy_text ?? {}) as Translatable,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by,
    };
  }

  async get(branchId: string): Promise<ReservationSettings> {
    const found = await this.find(branchId);
    if (!found) return { ...DEFAULT_RESERVATION_SETTINGS };
    return {
      reminderHoursBefore: found.reminderHoursBefore,
      minLeadMinutes: found.minLeadMinutes,
      maxDaysAhead: found.maxDaysAhead,
      policyText: found.policyText,
    };
  }

  async upsert(branchId: string, settings: ReservationSettings, userId: string | null): Promise<void> {
    const values = {
      reminder_hours_before: settings.reminderHoursBefore,
      min_lead_minutes: settings.minLeadMinutes,
      max_days_ahead: settings.maxDaysAhead,
      policy_text: JSON.stringify(settings.policyText),
      updated_by: userId,
    };
    await this.db()
      .insertInto('reservation.branch_settings')
      .values({ branch_id: branchId, ...values })
      .onConflict((oc) => oc.column('branch_id').doUpdateSet(values))
      .execute();
  }
}
