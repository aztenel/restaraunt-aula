import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { VenueRules } from '../domain/venue-rules';
import { ReservationTables, VenueTypesTable } from './reservation.tables';

/** Тип места (стол, VIP-зал, юрта, терраса...) с правилами брони по умолчанию. */
export interface VenueTypeRecord {
  id: string;
  code: string;
  name: Translatable;
  description: Translatable;
  rules: VenueRules;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type VenueTypeWrite = Omit<VenueTypeRecord, 'id' | 'createdAt' | 'updatedAt'>;

export function typeRulesOf(row: Pick<
  Selectable<VenueTypesTable>,
  | 'duration_minutes'
  | 'hold_minutes'
  | 'cancellation_deadline_hours'
  | 'requires_manual_confirmation'
  | 'cleanup_minutes'
  | 'slot_step_minutes'
  | 'bookable_online'
>): VenueRules {
  return {
    durationMinutes: row.duration_minutes,
    holdMinutes: row.hold_minutes,
    cancellationDeadlineHours: row.cancellation_deadline_hours,
    requiresManualConfirmation: row.requires_manual_confirmation,
    cleanupMinutes: row.cleanup_minutes,
    slotStepMinutes: row.slot_step_minutes,
    bookableOnline: row.bookable_online,
  };
}

function mapType(row: Selectable<VenueTypesTable>): VenueTypeRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    rules: typeRulesOf(row),
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(data: VenueTypeWrite) {
  return {
    code: data.code,
    name: JSON.stringify(data.name),
    description: JSON.stringify(data.description),
    duration_minutes: data.rules.durationMinutes,
    hold_minutes: data.rules.holdMinutes,
    cancellation_deadline_hours: data.rules.cancellationDeadlineHours,
    requires_manual_confirmation: data.rules.requiresManualConfirmation,
    cleanup_minutes: data.rules.cleanupMinutes,
    slot_step_minutes: data.rules.slotStepMinutes,
    bookable_online: data.rules.bookableOnline,
    sort_order: data.sortOrder,
    is_active: data.isActive,
  };
}

@Injectable()
export class VenueTypeRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReservationTables>();
  }

  async findById(id: string): Promise<VenueTypeRecord | null> {
    const row = await this.db()
      .selectFrom('reservation.venue_types')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapType(row) : null;
  }

  async findByCode(code: string): Promise<VenueTypeRecord | null> {
    const row = await this.db()
      .selectFrom('reservation.venue_types')
      .selectAll()
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapType(row) : null;
  }

  async list(options: { activeOnly?: boolean } = {}): Promise<VenueTypeRecord[]> {
    let q = this.db().selectFrom('reservation.venue_types').selectAll().where('deleted_at', 'is', null);
    if (options.activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('code').execute();
    return rows.map(mapType);
  }

  async insert(id: string, data: VenueTypeWrite): Promise<void> {
    await this.db()
      .insertInto('reservation.venue_types')
      .values({ id, ...toRow(data) })
      .execute();
  }

  async update(id: string, data: VenueTypeWrite): Promise<void> {
    await this.db().updateTable('reservation.venue_types').set(toRow(data)).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('reservation.venue_types').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }
}
