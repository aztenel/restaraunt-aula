import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { CustomerFilter } from '../domain/customer-filter';
import { CustomersTables, SegmentsTable } from './customers.tables';

export interface SegmentRecord {
  id: string;
  name: string;
  description: string | null;
  filter: CustomerFilter;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapSegment(row: Selectable<SegmentsTable>): SegmentRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    filter: (row.filter ?? {}) as CustomerFilter,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Сегменты гостей — сохранённые фильтры. Удаление логическое. */
@Injectable()
export class SegmentRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<CustomersTables>();
  }

  async findById(id: string): Promise<SegmentRecord | null> {
    const row = await this.db()
      .selectFrom('customers.segments')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? mapSegment(row) : null;
  }

  async findByName(name: string, exceptId?: string): Promise<SegmentRecord | null> {
    let q = this.db()
      .selectFrom('customers.segments')
      .selectAll()
      .where(sql<boolean>`lower(name) = lower(${name})`)
      .where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    const row = await q.executeTakeFirst();
    return row ? mapSegment(row) : null;
  }

  async list(): Promise<SegmentRecord[]> {
    const rows = await this.db().selectFrom('customers.segments').selectAll().where('deleted_at', 'is', null).orderBy('name').execute();
    return rows.map(mapSegment);
  }

  async insert(input: { id: string; name: string; description: string | null; filter: CustomerFilter; userId: string | null }): Promise<void> {
    await this.db()
      .insertInto('customers.segments')
      .values({
        id: input.id,
        name: input.name,
        description: input.description,
        filter: JSON.stringify(input.filter),
        created_by: input.userId,
        updated_by: input.userId,
        deleted_at: null,
      })
      .execute();
  }

  async update(id: string, input: { name: string; description: string | null; filter: CustomerFilter; userId: string | null }): Promise<void> {
    await this.db()
      .updateTable('customers.segments')
      .set({ name: input.name, description: input.description, filter: JSON.stringify(input.filter), updated_by: input.userId })
      .where('id', '=', id)
      .execute();
  }

  async softDelete(id: string, at: Date, userId: string | null): Promise<void> {
    await this.db().updateTable('customers.segments').set({ deleted_at: at, updated_by: userId }).where('id', '=', id).execute();
  }
}
