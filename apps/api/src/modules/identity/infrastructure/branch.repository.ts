import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Translatable } from '../../../shared/kernel/translatable';
import { OpeningHours } from '../../../shared/kernel/time';
import { BranchInfo, BranchSettings, DEFAULT_BRANCH_SETTINGS } from '../public/branch-directory';
import { BranchesTable, IdentityTables } from './identity.tables';

export function mapBranch(row: Selectable<BranchesTable>): BranchInfo {
  return {
    id: row.id,
    code: row.code,
    slug: row.slug,
    name: row.name as Translatable,
    address: row.address as Translatable,
    location: { lat: row.lat, lng: row.lng },
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    timezone: row.timezone,
    openingHours: row.opening_hours as OpeningHours,
    settings: { ...DEFAULT_BRANCH_SETTINGS, ...((row.settings as Partial<BranchSettings>) ?? {}) },
    legalEntityId: row.legal_entity_id,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}

export interface BranchWrite {
  code: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  location: { lat: number; lng: number };
  phone: string;
  whatsapp: string | null;
  email: string | null;
  timezone: string;
  openingHours: OpeningHours;
  settings: BranchSettings;
  legalEntityId: string | null;
  isActive: boolean;
  sortOrder: number;
}

@Injectable()
export class BranchRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<IdentityTables>();
  }

  async findById(id: string): Promise<BranchInfo | null> {
    const row = await this.db()
      .selectFrom('identity.branches')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapBranch(row) : null;
  }

  async findBySlug(slug: string): Promise<BranchInfo | null> {
    const row = await this.db()
      .selectFrom('identity.branches')
      .selectAll()
      .where('slug', '=', slug)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapBranch(row) : null;
  }

  async findByCodeOrSlug(code: string, slug: string, exceptId?: string): Promise<BranchInfo | null> {
    let q = this.db()
      .selectFrom('identity.branches')
      .selectAll()
      .where('deleted_at', 'is', null)
      .where((eb) => eb.or([eb('code', '=', code), eb('slug', '=', slug)]));
    if (exceptId) q = q.where('id', '!=', exceptId);
    const row = await q.executeTakeFirst();
    return row ? mapBranch(row) : null;
  }

  async list(activeOnly: boolean): Promise<BranchInfo[]> {
    let q = this.db().selectFrom('identity.branches').selectAll().where('deleted_at', 'is', null);
    if (activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.orderBy('sort_order').orderBy('code').execute();
    return rows.map((r) => mapBranch(r));
  }

  async insert(id: string, data: BranchWrite): Promise<void> {
    await this.db()
      .insertInto('identity.branches')
      .values({ id, ...this.toRow(data), deleted_at: null })
      .execute();
  }

  async update(id: string, data: BranchWrite): Promise<void> {
    await this.db().updateTable('identity.branches').set(this.toRow(data)).where('id', '=', id).execute();
  }

  private toRow(data: BranchWrite) {
    return {
      code: data.code,
      slug: data.slug,
      name: JSON.stringify(data.name),
      address: JSON.stringify(data.address),
      lat: data.location.lat,
      lng: data.location.lng,
      phone: data.phone,
      whatsapp: data.whatsapp,
      email: data.email,
      timezone: data.timezone,
      opening_hours: JSON.stringify(data.openingHours),
      settings: JSON.stringify(data.settings),
      legal_entity_id: data.legalEntityId,
      is_active: data.isActive,
      sort_order: data.sortOrder,
    };
  }
}
