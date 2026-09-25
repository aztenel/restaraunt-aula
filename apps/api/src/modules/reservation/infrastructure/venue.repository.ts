import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Currency, Money } from '../../../shared/kernel/money';
import { Translatable } from '../../../shared/kernel/translatable';
import { isStoredImage, StoredImage } from '../domain/images';
import { HallPlanSize, VenuePosition, VenueShape } from '../domain/venue';
import { effectiveRules, VenueRuleOverrides, VenueRules } from '../domain/venue-rules';
import { ReservationTables, VenuesTable } from './reservation.tables';
import { typeRulesOf } from './venue-type.repository';

/** Место: стол, VIP-зал, юрта... Вместимость, депозит, переопределения правил типа, позиция на плане зала. */
export interface VenueRecord {
  id: string;
  branchId: string;
  hallId: string;
  typeId: string;
  code: string;
  name: Translatable;
  description: Translatable;
  capacityMin: number;
  capacityMax: number;
  deposit: Money | null;
  ruleOverrides: VenueRuleOverrides;
  position: VenuePosition;
  photos: StoredImage[];
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type VenueWrite = Omit<VenueRecord, 'id' | 'createdAt' | 'updatedAt' | 'photos'>;

/** Место вместе с залом, типом и действующими правилами (тип + переопределения места). */
export interface VenueDetails extends VenueRecord {
  hall: { id: string; code: string; name: Translatable; plan: HallPlanSize; isActive: boolean; sortOrder: number };
  type: { id: string; code: string; name: Translatable; isActive: boolean; rules: VenueRules };
  rules: VenueRules;
}

export interface VenueFilter {
  branchIds: 'all' | string[];
  hallId?: string;
  typeId?: string;
  typeCode?: string;
  /** Только активные места в активных залах, активного типа. */
  activeOnly?: boolean;
  ids?: string[];
  /** Включая удалённые из справочника (для истории броней). */
  includeDeleted?: boolean;
}

function mapVenue(row: Selectable<VenuesTable>): VenueRecord {
  return {
    id: row.id,
    branchId: row.branch_id,
    hallId: row.hall_id,
    typeId: row.type_id,
    code: row.code,
    name: row.name as Translatable,
    description: (row.description ?? {}) as Translatable,
    capacityMin: row.capacity_min,
    capacityMax: row.capacity_max,
    deposit: row.deposit_amount === null ? null : Money.of(row.deposit_amount, row.deposit_currency as Currency),
    ruleOverrides: (row.rules ?? {}) as VenueRuleOverrides,
    position: { x: row.pos_x, y: row.pos_y, w: row.pos_w, h: row.pos_h, shape: row.shape as VenueShape, rotation: row.rotation },
    photos: Array.isArray(row.photos) ? (row.photos as unknown[]).filter(isStoredImage) : [],
    sortOrder: row.sort_order,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(data: VenueWrite) {
  return {
    branch_id: data.branchId,
    hall_id: data.hallId,
    type_id: data.typeId,
    code: data.code,
    name: JSON.stringify(data.name),
    description: JSON.stringify(data.description),
    capacity_min: data.capacityMin,
    capacity_max: data.capacityMax,
    deposit_amount: data.deposit?.amount ?? null,
    deposit_currency: data.deposit?.currency ?? 'KZT',
    rules: JSON.stringify(data.ruleOverrides),
    pos_x: data.position.x,
    pos_y: data.position.y,
    pos_w: data.position.w,
    pos_h: data.position.h,
    shape: data.position.shape,
    rotation: data.position.rotation,
    sort_order: data.sortOrder,
    is_active: data.isActive,
  };
}

@Injectable()
export class VenueRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<ReservationTables>();
  }

  async findById(id: string): Promise<VenueRecord | null> {
    const row = await this.db().selectFrom('reservation.venues').selectAll().where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
    return row ? mapVenue(row) : null;
  }

  async findByCode(branchId: string, code: string): Promise<VenueRecord | null> {
    const row = await this.db()
      .selectFrom('reservation.venues')
      .selectAll()
      .where('branch_id', '=', branchId)
      .where('code', '=', code)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapVenue(row) : null;
  }

  async findDetailed(id: string, options: { includeDeleted?: boolean } = {}): Promise<VenueDetails | null> {
    const [venue] = await this.listDetailed({ branchIds: 'all', ids: [id], includeDeleted: options.includeDeleted });
    return venue ?? null;
  }

  /** Места с залом и типом; порядок — зал, место, код. */
  async listDetailed(filter: VenueFilter): Promise<VenueDetails[]> {
    if (filter.branchIds !== 'all' && filter.branchIds.length === 0) return [];
    if (filter.ids && filter.ids.length === 0) return [];
    let q = this.db()
      .selectFrom('reservation.venues as v')
      .innerJoin('reservation.halls as h', 'h.id', 'v.hall_id')
      .innerJoin('reservation.venue_types as t', 't.id', 'v.type_id')
      .selectAll('v')
      .select([
        'h.code as hall_code',
        'h.name as hall_name',
        'h.plan_width as hall_plan_width',
        'h.plan_height as hall_plan_height',
        'h.is_active as hall_is_active',
        'h.sort_order as hall_sort_order',
        't.code as type_code',
        't.name as type_name',
        't.is_active as type_is_active',
        't.duration_minutes',
        't.hold_minutes',
        't.cancellation_deadline_hours',
        't.requires_manual_confirmation',
        't.cleanup_minutes',
        't.slot_step_minutes',
        't.bookable_online',
      ]);
    if (!filter.includeDeleted) q = q.where('v.deleted_at', 'is', null);
    if (filter.branchIds !== 'all') q = q.where('v.branch_id', 'in', filter.branchIds);
    if (filter.ids) q = q.where('v.id', 'in', filter.ids);
    if (filter.hallId) q = q.where('v.hall_id', '=', filter.hallId);
    if (filter.typeId) q = q.where('v.type_id', '=', filter.typeId);
    if (filter.typeCode) q = q.where('t.code', '=', filter.typeCode);
    if (filter.activeOnly) {
      q = q.where('v.is_active', '=', true).where('h.is_active', '=', true).where('t.is_active', '=', true).where('h.deleted_at', 'is', null);
    }
    const rows = await q.orderBy('h.sort_order').orderBy('h.code').orderBy('v.sort_order').orderBy('v.code').execute();
    return rows.map((row) => {
      const venue = mapVenue(row);
      const typeRules = typeRulesOf(row);
      return {
        ...venue,
        hall: {
          id: venue.hallId,
          code: row.hall_code,
          name: row.hall_name as Translatable,
          plan: { width: row.hall_plan_width, height: row.hall_plan_height },
          isActive: row.hall_is_active,
          sortOrder: row.hall_sort_order,
        },
        type: { id: venue.typeId, code: row.type_code, name: row.type_name as Translatable, isActive: row.type_is_active, rules: typeRules },
        rules: effectiveRules(typeRules, venue.ruleOverrides),
      };
    });
  }

  /**
   * Блокировка строк мест до конца транзакции (select ... for update). Порядок блокировки — по id,
   * чтобы параллельные переносы между двумя местами не взаимоблокировались.
   */
  async lockForUpdate(ids: readonly string[]): Promise<string[]> {
    const unique = [...new Set(ids)].sort();
    if (unique.length === 0) return [];
    const rows = await this.db().selectFrom('reservation.venues').select('id').where('id', 'in', unique).orderBy('id').forUpdate().execute();
    return rows.map((r) => r.id);
  }

  async insert(id: string, data: VenueWrite): Promise<void> {
    await this.db()
      .insertInto('reservation.venues')
      .values({ id, ...toRow(data), photos: JSON.stringify([]) })
      .execute();
  }

  async update(id: string, data: VenueWrite): Promise<void> {
    await this.db().updateTable('reservation.venues').set(toRow(data)).where('id', '=', id).execute();
  }

  async setPhotos(id: string, photos: StoredImage[]): Promise<void> {
    await this.db().updateTable('reservation.venues').set({ photos: JSON.stringify(photos) }).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('reservation.venues').set({ deleted_at: at, is_active: false }).where('id', '=', id).execute();
  }

  async countByHall(hallId: string): Promise<number> {
    const row = await this.db()
      .selectFrom('reservation.venues')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('hall_id', '=', hallId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async countByType(typeId: string): Promise<number> {
    const row = await this.db()
      .selectFrom('reservation.venues')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('type_id', '=', typeId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
