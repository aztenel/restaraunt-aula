import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { ClientCompanyInput, normalizeCompany } from '../domain/company';
import { ClientCompanyRecord, CompanyRepository } from '../infrastructure/company.repository';

/** Реквизиты заказчиков ведут банкетные менеджеры (banquets.manage) и финансы (banquets.invoice). */
export function assertCanEditCompanies(actor: Actor): void {
  if (actor.canSomewhere(Permission.BanquetsInvoice)) return;
  actor.assertCanSomewhere(Permission.BanquetsManage);
}

@Injectable()
export class CreateClientCompany {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: ClientCompanyInput): Promise<ClientCompanyRecord> {
    assertCanEditCompanies(actor);
    const data = normalizeCompany(input);
    return this.database.transaction(async () => {
      const existing = await this.companies.findByBin(data.bin);
      if (existing) {
        throw new ConflictError('banquet_company.duplicate_bin', 'Company with this BIN already exists', { companyId: existing.id });
      }
      const id = newId();
      await this.companies.insert(id, data);
      await this.audit.record({ action: 'banquet.company_created', entityType: 'banquet_company', entityId: id, after: data, actor });
      return (await this.companies.findById(id))!;
    });
  }
}

@Injectable()
export class UpdateClientCompany {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, input: ClientCompanyInput): Promise<ClientCompanyRecord> {
    assertCanEditCompanies(actor);
    const data = normalizeCompany(input);
    return this.database.transaction(async () => {
      const current = await this.companies.findById(id);
      if (!current) throw new NotFoundError('banquet_company', id);
      if (await this.companies.findByBin(data.bin, id)) {
        throw new ConflictError('banquet_company.duplicate_bin', 'Company with this BIN already exists');
      }
      await this.companies.update(id, data);
      const { id: _id, createdAt: _c, updatedAt: _u, ...before } = current;
      await this.audit.record({ action: 'banquet.company_updated', entityType: 'banquet_company', entityId: id, before, after: data, actor });
      return (await this.companies.findById(id))!;
    });
  }
}

/** Удаление логическое: выставленные документы хранят снимок реквизитов. */
@Injectable()
export class DeleteClientCompany {
  constructor(
    private readonly companies: CompanyRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    assertCanEditCompanies(actor);
    await this.database.transaction(async () => {
      const current = await this.companies.findById(id);
      if (!current) throw new NotFoundError('banquet_company', id);
      await this.companies.softDelete(id, this.clock.now());
      await this.audit.record({ action: 'banquet.company_deleted', entityType: 'banquet_company', entityId: id, before: { name: current.name, bin: current.bin }, actor });
    });
  }
}
