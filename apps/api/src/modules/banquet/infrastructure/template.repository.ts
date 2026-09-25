import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { BanquetTables, ContractTemplatesTable } from './banquet.tables';

export interface ContractTemplateRecord {
  id: string;
  code: string;
  name: string;
  body: string;
  isDefault: boolean;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ContractTemplateWrite {
  code: string;
  name: string;
  body: string;
  isDefault: boolean;
}

function map(r: Selectable<ContractTemplatesTable>): ContractTemplateRecord {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    body: r.body,
    isDefault: r.is_default,
    updatedBy: r.updated_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

@Injectable()
export class TemplateRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async insert(id: string, data: ContractTemplateWrite, userId: string | null): Promise<void> {
    await this.db()
      .insertInto('banquet.contract_templates')
      .values({ id, code: data.code, name: data.name, body: data.body, is_default: data.isDefault, updated_by: userId, deleted_at: null })
      .execute();
  }

  async update(id: string, data: ContractTemplateWrite, userId: string | null): Promise<void> {
    await this.db()
      .updateTable('banquet.contract_templates')
      .set({ code: data.code, name: data.name, body: data.body, is_default: data.isDefault, updated_by: userId })
      .where('id', '=', id)
      .execute();
  }

  /** Снять признак «по умолчанию» со всех шаблонов, кроме указанного. */
  async clearDefault(exceptId: string): Promise<void> {
    await this.db()
      .updateTable('banquet.contract_templates')
      .set({ is_default: false })
      .where('is_default', '=', true)
      .where('id', '!=', exceptId)
      .execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('banquet.contract_templates').set({ deleted_at: at, is_default: false }).where('id', '=', id).execute();
  }

  async findById(id: string): Promise<ContractTemplateRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.contract_templates')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? map(row) : null;
  }

  async findByCode(code: string, exceptId?: string): Promise<ContractTemplateRecord | null> {
    let q = this.db().selectFrom('banquet.contract_templates').selectAll().where('code', '=', code).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    const row = await q.executeTakeFirst();
    return row ? map(row) : null;
  }

  async findDefault(): Promise<ContractTemplateRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.contract_templates')
      .selectAll()
      .where('is_default', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? map(row) : null;
  }

  async list(): Promise<ContractTemplateRecord[]> {
    const rows = await this.db()
      .selectFrom('banquet.contract_templates')
      .selectAll()
      .where('deleted_at', 'is', null)
      .orderBy('is_default', 'desc')
      .orderBy('name')
      .execute();
    return rows.map(map);
  }
}
