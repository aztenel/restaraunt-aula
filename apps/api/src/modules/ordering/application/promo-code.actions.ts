import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { PromoCodeDefinition, PromoCodeState, validatePromoDefinition } from '../domain/promo-code';
import { PromoCodeRepository } from '../infrastructure/promo-code.repository';

const CODE_LOCK = 'ordering.promo_code';

function auditState(p: PromoCodeDefinition): Record<string, unknown> {
  return {
    code: p.code,
    description: p.description,
    kind: p.kind,
    percentBp: p.percentBp,
    fixedAmount: p.fixedAmount?.toJSON() ?? null,
    minSubtotal: p.minSubtotal?.toJSON() ?? null,
    validFrom: p.validFrom?.toISOString() ?? null,
    validTo: p.validTo?.toISOString() ?? null,
    totalLimit: p.totalLimit,
    perPhoneLimit: p.perPhoneLimit,
    branchId: p.branchId,
    isActive: p.isActive,
  };
}

/**
 * Промокод филиала — право promocodes.manage в этом филиале (управляющий); промокод на всю сеть
 * (branchId = null) — только с глобальным правом (контент-менеджер, собственник).
 */
function assertCanManage(actor: Actor, branchId: string | null): void {
  actor.assertCan(Permission.PromoCodesManage, branchId);
}

@Injectable()
export class CreatePromoCode {
  constructor(
    private readonly promos: PromoCodeRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: PromoCodeDefinition): Promise<PromoCodeState> {
    assertCanManage(actor, input.branchId);
    const def = validatePromoDefinition(input);
    if (def.branchId) await this.branches.get(def.branchId);
    const id = newId();
    await this.database.transaction(async () => {
      await this.database.advisoryLock(CODE_LOCK, def.code);
      if (await this.promos.findByCode(def.code)) {
        throw new ConflictError('promo.duplicate_code', 'Promo code with this code already exists', { code: def.code });
      }
      await this.promos.insert(id, def);
      await this.audit.record({ action: 'promo_code.created', entityType: 'promo_code', entityId: id, branchId: def.branchId, after: auditState(def), actor });
    });
    return (await this.promos.findById(id))!;
  }
}

@Injectable()
export class UpdatePromoCode {
  constructor(
    private readonly promos: PromoCodeRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, input: PromoCodeDefinition): Promise<PromoCodeState> {
    const current = await this.promos.findById(id);
    if (!current) throw new NotFoundError('promo_code', id);
    assertCanManage(actor, current.branchId);
    assertCanManage(actor, input.branchId);
    const def = validatePromoDefinition(input);
    if (def.branchId) await this.branches.get(def.branchId);
    await this.database.transaction(async () => {
      await this.database.advisoryLock(CODE_LOCK, def.code);
      const sameCode = await this.promos.findByCode(def.code);
      if (sameCode && sameCode.id !== id) {
        throw new ConflictError('promo.duplicate_code', 'Promo code with this code already exists', { code: def.code });
      }
      await this.promos.update(id, def);
      await this.audit.record({
        action: 'promo_code.updated',
        entityType: 'promo_code',
        entityId: id,
        branchId: def.branchId ?? current.branchId,
        before: auditState(current),
        after: auditState(def),
        actor,
      });
    });
    return (await this.promos.findById(id))!;
  }
}

/** Удаление — логическое: использования в прошлых заказах сохраняются. */
@Injectable()
export class DeletePromoCode {
  constructor(
    private readonly promos: PromoCodeRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    const current = await this.promos.findById(id);
    if (!current) throw new NotFoundError('promo_code', id);
    assertCanManage(actor, current.branchId);
    await this.database.transaction(async () => {
      await this.promos.softDelete(id, this.clock.now());
      await this.audit.record({
        action: 'promo_code.deleted',
        entityType: 'promo_code',
        entityId: id,
        branchId: current.branchId,
        before: auditState(current),
        actor,
      });
    });
  }
}
