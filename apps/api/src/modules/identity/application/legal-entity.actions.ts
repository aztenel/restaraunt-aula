import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { LegalEntityRepository, LegalEntityWrite } from '../infrastructure/legal-entity.repository';
import { LegalEntityInfo } from '../public/legal-entities';

export type LegalEntityInput = Omit<LegalEntityInfo, 'id'> & { isDefault?: boolean };

export function validateLegalEntity(input: LegalEntityInput): LegalEntityWrite {
  const bin = input.bin.replace(/\s/g, '');
  if (!/^\d{12}$/.test(bin)) throw new ValidationError('legal_entity.invalid_bin', 'BIN must be 12 digits');
  const iban = input.iban.replace(/\s/g, '').toUpperCase();
  if (iban && !/^KZ\d{2}[0-9A-Z]{16}$/.test(iban)) {
    throw new ValidationError('legal_entity.invalid_iban', 'IBAN (ИИК) must look like KZ + 18 characters');
  }
  if (!Number.isInteger(input.vatRateBp) || input.vatRateBp < 0 || input.vatRateBp > 10_000) {
    throw new ValidationError('legal_entity.invalid_vat', 'VAT rate must be 0..10000 basis points');
  }
  if (input.vatPayer && input.vatRateBp === 0) {
    throw new ValidationError('legal_entity.vat_rate_required', 'VAT payer must have a VAT rate');
  }
  if (!input.name.trim() || !input.legalAddress.trim() || !input.directorName.trim()) {
    throw new ValidationError('legal_entity.required', 'Name, legal address and director are required');
  }
  return {
    ...input,
    bin,
    iban,
    bik: input.bik.trim().toUpperCase(),
    vatRateBp: input.vatPayer ? input.vatRateBp : 0,
    isDefault: input.isDefault ?? false,
  };
}

@Injectable()
export class SaveLegalEntity {
  constructor(
    private readonly repo: LegalEntityRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string | null, input: LegalEntityInput) {
    actor.assertCan(Permission.BranchesManage);
    const data = validateLegalEntity(input);
    const current = id ? await this.repo.findById(id) : null;
    if (id && !current) throw new NotFoundError('legal_entity', id);
    const sameBin = await this.repo.findByBin(data.bin);
    if (sameBin && sameBin.id !== id) throw new ConflictError('legal_entity.duplicate_bin', 'Legal entity with this BIN exists');
    const entityId = id ?? newId();
    await this.database.transaction(async () => {
      if (current) await this.repo.update(entityId, data);
      else await this.repo.insert(entityId, data);
      if (data.isDefault) await this.repo.clearDefault(entityId);
      await this.audit.record({
        action: current ? 'legal_entity.updated' : 'legal_entity.created',
        entityType: 'legal_entity',
        entityId,
        before: current,
        after: data,
      });
    });
    return (await this.repo.findById(entityId))!;
  }
}
