import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { BranchDirectory } from '../../identity/public';
import { assertNoOverlap, DeliveryZoneDefinition, DeliveryZoneState, validateZoneDefinition } from '../domain/delivery-zone';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';

/** Блокировка зон филиала: проверка непересечения и запись — под одной advisory-блокировкой. */
const ZONES_LOCK = 'ordering.delivery_zones';

function auditState(zone: DeliveryZoneDefinition): Record<string, unknown> {
  return {
    name: zone.name,
    polygon: zone.polygon,
    minOrderAmount: zone.minOrderAmount.toJSON(),
    deliveryFee: zone.deliveryFee.toJSON(),
    freeDeliveryFrom: zone.freeDeliveryFrom?.toJSON() ?? null,
    etaMinutes: zone.etaMinutes,
    isActive: zone.isActive,
    sortOrder: zone.sortOrder,
  };
}

/** Новая зона доставки филиала (delivery_zones.manage в филиале). Зоны филиала не пересекаются. */
@Injectable()
export class CreateDeliveryZone {
  constructor(
    private readonly zones: DeliveryZoneRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, branchId: string, input: DeliveryZoneDefinition): Promise<DeliveryZoneState> {
    actor.assertCan(Permission.DeliveryZonesManage, branchId);
    await this.branches.get(branchId);
    const def = validateZoneDefinition(input);
    const id = newId();
    await this.database.transaction(async () => {
      await this.database.advisoryLock(ZONES_LOCK, branchId);
      assertNoOverlap({ id: null, polygon: def.polygon }, await this.zones.listForBranch(branchId));
      await this.zones.insert(id, branchId, def);
      await this.audit.record({ action: 'delivery_zone.created', entityType: 'delivery_zone', entityId: id, branchId, after: auditState(def), actor });
    });
    return (await this.zones.findById(id))!;
  }
}

@Injectable()
export class UpdateDeliveryZone {
  constructor(
    private readonly zones: DeliveryZoneRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, zoneId: string, input: DeliveryZoneDefinition): Promise<DeliveryZoneState> {
    const current = await this.zones.findById(zoneId);
    if (!current) throw new NotFoundError('delivery_zone', zoneId);
    actor.assertCan(Permission.DeliveryZonesManage, current.branchId);
    const def = validateZoneDefinition(input);
    await this.database.transaction(async () => {
      await this.database.advisoryLock(ZONES_LOCK, current.branchId);
      assertNoOverlap({ id: zoneId, polygon: def.polygon }, await this.zones.listForBranch(current.branchId));
      await this.zones.update(zoneId, def);
      await this.audit.record({
        action: 'delivery_zone.updated',
        entityType: 'delivery_zone',
        entityId: zoneId,
        branchId: current.branchId,
        before: auditState(current),
        after: auditState(def),
        actor,
      });
    });
    return (await this.zones.findById(zoneId))!;
  }
}

/** Удаление зоны — логическое (deleted_at): прошлые заказы ссылаются на зону. */
@Injectable()
export class DeleteDeliveryZone {
  constructor(
    private readonly zones: DeliveryZoneRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, zoneId: string): Promise<void> {
    const current = await this.zones.findById(zoneId);
    if (!current) throw new NotFoundError('delivery_zone', zoneId);
    actor.assertCan(Permission.DeliveryZonesManage, current.branchId);
    await this.database.transaction(async () => {
      await this.database.advisoryLock(ZONES_LOCK, current.branchId);
      await this.zones.softDelete(zoneId, this.clock.now());
      await this.audit.record({
        action: 'delivery_zone.deleted',
        entityType: 'delivery_zone',
        entityId: zoneId,
        branchId: current.branchId,
        before: auditState(current),
        actor,
      });
    });
  }
}
