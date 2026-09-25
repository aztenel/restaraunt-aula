import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { offsetOf, PageRequest } from '../../../shared/kernel/pagination';
import { ClientCompanyData } from '../domain/company';
import { BanquetTables, ClientCompaniesTable } from './banquet.tables';

export interface ClientCompanyRecord extends ClientCompanyData {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

function map(r: Selectable<ClientCompaniesTable>): ClientCompanyRecord {
  return {
    id: r.id,
    name: r.name,
    bin: r.bin,
    legalAddress: r.legal_address,
    bankName: r.bank_name,
    iban: r.iban,
    bik: r.bik,
    kbe: r.kbe,
    directorName: r.director_name,
    directorPosition: r.director_position,
    actingBasis: r.acting_basis,
    contactName: r.contact_name,
    contactPhone: r.contact_phone,
    contactEmail: r.contact_email,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toRow(d: ClientCompanyData) {
  return {
    name: d.name,
    bin: d.bin,
    legal_address: d.legalAddress,
    bank_name: d.bankName,
    iban: d.iban,
    bik: d.bik,
    kbe: d.kbe,
    director_name: d.directorName,
    director_position: d.directorPosition,
    acting_basis: d.actingBasis,
    contact_name: d.contactName,
    contact_phone: d.contactPhone,
    contact_email: d.contactEmail,
  };
}

@Injectable()
export class CompanyRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<BanquetTables>();
  }

  async insert(id: string, data: ClientCompanyData): Promise<void> {
    await this.db()
      .insertInto('banquet.client_companies')
      .values({ id, ...toRow(data), deleted_at: null })
      .execute();
  }

  async update(id: string, data: ClientCompanyData): Promise<void> {
    await this.db().updateTable('banquet.client_companies').set(toRow(data)).where('id', '=', id).execute();
  }

  async softDelete(id: string, at: Date): Promise<void> {
    await this.db().updateTable('banquet.client_companies').set({ deleted_at: at }).where('id', '=', id).execute();
  }

  async findById(id: string): Promise<ClientCompanyRecord | null> {
    const row = await this.db()
      .selectFrom('banquet.client_companies')
      .selectAll()
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return row ? map(row) : null;
  }

  async findByBin(bin: string, exceptId?: string): Promise<ClientCompanyRecord | null> {
    let q = this.db().selectFrom('banquet.client_companies').selectAll().where('bin', '=', bin).where('deleted_at', 'is', null);
    if (exceptId) q = q.where('id', '!=', exceptId);
    const row = await q.executeTakeFirst();
    return row ? map(row) : null;
  }

  /** Поиск по названию (подстрока, без учёта регистра) или по БИН. */
  async search(query: string | undefined, page: PageRequest): Promise<{ items: ClientCompanyRecord[]; total: number }> {
    let q = this.db().selectFrom('banquet.client_companies').where('deleted_at', 'is', null);
    const term = query?.trim();
    if (term) {
      const like = `%${term.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      const digits = term.replace(/\D/g, '');
      q = q.where((eb) => eb.or([eb(sql`lower(name)`, 'like', like), ...(digits.length >= 4 ? [eb('bin', 'like', `${digits}%`)] : [])]));
    }
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('name').orderBy('id').limit(page.perPage).offset(offsetOf(page)).execute();
    return { items: rows.map(map), total: Number(total?.n ?? 0) };
  }
}
