import { Injectable } from '@nestjs/common';
import { Selectable } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { LegalEntityInfo } from '../public/legal-entities';
import { IdentityTables, LegalEntitiesTable } from './identity.tables';

export function mapLegalEntity(row: Selectable<LegalEntitiesTable>): LegalEntityInfo & { isDefault: boolean } {
  return {
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    bin: row.bin,
    legalAddress: row.legal_address,
    actualAddress: row.actual_address,
    directorName: row.director_name,
    directorPosition: row.director_position,
    actingBasis: row.acting_basis,
    bankName: row.bank_name,
    iban: row.iban,
    bik: row.bik,
    kbe: row.kbe,
    vatPayer: row.vat_payer,
    vatRateBp: row.vat_rate_bp,
    vatCertificate: row.vat_certificate,
    phone: row.phone,
    email: row.email,
    isDefault: row.is_default,
  };
}

export type LegalEntityWrite = Omit<LegalEntityInfo, 'id'> & { isDefault: boolean };

@Injectable()
export class LegalEntityRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<IdentityTables>();
  }

  async findById(id: string) {
    const row = await this.db().selectFrom('identity.legal_entities').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? mapLegalEntity(row) : null;
  }

  async findDefault() {
    const row = await this.db().selectFrom('identity.legal_entities').selectAll().where('is_default', '=', true).executeTakeFirst();
    return row ? mapLegalEntity(row) : null;
  }

  async findByBin(bin: string) {
    const row = await this.db().selectFrom('identity.legal_entities').selectAll().where('bin', '=', bin).executeTakeFirst();
    return row ? mapLegalEntity(row) : null;
  }

  async list() {
    const rows = await this.db().selectFrom('identity.legal_entities').selectAll().orderBy('name').execute();
    return rows.map((r) => mapLegalEntity(r));
  }

  async clearDefault(exceptId: string): Promise<void> {
    await this.db().updateTable('identity.legal_entities').set({ is_default: false }).where('id', '!=', exceptId).execute();
  }

  async insert(id: string, data: LegalEntityWrite): Promise<void> {
    await this.db()
      .insertInto('identity.legal_entities')
      .values({ id, ...this.toRow(data) })
      .execute();
  }

  async update(id: string, data: LegalEntityWrite): Promise<void> {
    await this.db().updateTable('identity.legal_entities').set(this.toRow(data)).where('id', '=', id).execute();
  }

  private toRow(d: LegalEntityWrite) {
    return {
      name: d.name,
      short_name: d.shortName,
      bin: d.bin,
      legal_address: d.legalAddress,
      actual_address: d.actualAddress,
      director_name: d.directorName,
      director_position: d.directorPosition,
      acting_basis: d.actingBasis,
      bank_name: d.bankName,
      iban: d.iban,
      bik: d.bik,
      kbe: d.kbe,
      vat_payer: d.vatPayer,
      vat_rate_bp: d.vatRateBp,
      vat_certificate: d.vatCertificate,
      phone: d.phone,
      email: d.email,
      is_default: d.isDefault,
    };
  }
}
