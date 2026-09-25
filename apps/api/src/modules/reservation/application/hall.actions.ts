import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { assertTranslatable, normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { normalizeHallCode, validatePlanSize, validatePosition } from '../domain/venue';
import { HallRecord, HallRepository, HallWrite } from '../infrastructure/hall.repository';
import { VenueRepository } from '../infrastructure/venue.repository';

export interface HallInput {
  branchId: string;
  code: string;
  name: Translatable;
  description?: Translatable | null;
  planWidth?: number;
  planHeight?: number;
  sortOrder?: number;
  isActive?: boolean;
}

export type HallPatch = Partial<Omit<HallInput, 'branchId'>>;

export const DEFAULT_PLAN = { width: 1000, height: 600 } as const;

function toWrite(input: HallInput): HallWrite {
  return {
    branchId: input.branchId,
    code: normalizeHallCode(input.code),
    name: assertTranslatable(input.name, 'name'),
    description: normalizeTranslatable((input.description ?? {}) as Record<string, unknown>),
    plan: validatePlanSize({ width: input.planWidth ?? DEFAULT_PLAN.width, height: input.planHeight ?? DEFAULT_PLAN.height }),
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  };
}

async function assertUniqueCode(halls: HallRepository, branchId: string, code: string, exceptId?: string): Promise<void> {
  const existing = await halls.findByCode(branchId, code);
  if (existing && existing.id !== exceptId) {
    throw new ConflictError('reservation.hall_duplicate', 'Hall with this code already exists in the branch', { code });
  }
}

/** Залы филиала (карта залов: план в условных единицах, фон). Право venues.manage в филиале. */
@Injectable()
export class CreateHall {
  constructor(
    private readonly halls: HallRepository,
    private readonly branches: BranchDirectory,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: HallInput): Promise<HallRecord> {
    actor.assertCan(Permission.VenuesManage, input.branchId);
    if (!(await this.branches.find(input.branchId))) throw new NotFoundError('branch', input.branchId);
    const data = toWrite(input);
    const id = newId();
    await this.database.transaction(async () => {
      await assertUniqueCode(this.halls, data.branchId, data.code);
      await this.halls.insert(id, data);
      await this.audit.record({ action: 'reservation.hall_created', entityType: 'hall', entityId: id, branchId: data.branchId, after: data, actor });
    });
    return (await this.halls.findById(id))!;
  }
}

@Injectable()
export class UpdateHall {
  constructor(
    private readonly halls: HallRepository,
    private readonly venues: VenueRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, patch: HallPatch): Promise<HallRecord> {
    const current = await this.halls.findById(id);
    if (!current) throw new NotFoundError('hall', id);
    actor.assertCan(Permission.VenuesManage, current.branchId);
    const data = toWrite({
      branchId: current.branchId,
      code: patch.code ?? current.code,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      planWidth: patch.planWidth ?? current.plan.width,
      planHeight: patch.planHeight ?? current.plan.height,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
    });
    await this.database.transaction(async () => {
      await assertUniqueCode(this.halls, data.branchId, data.code, id);
      // Уменьшение плана не должно «выталкивать» места за его границы.
      for (const venue of await this.venues.listDetailed({ branchIds: [current.branchId], hallId: id })) {
        try {
          validatePosition(venue.position, data.plan);
        } catch {
          throw new ValidationError('reservation.plan_too_small', 'Venues would not fit into the reduced hall plan', {
            venueId: venue.id,
            code: venue.code,
          });
        }
      }
      await this.halls.update(id, data);
      await this.audit.record({
        action: 'reservation.hall_updated',
        entityType: 'hall',
        entityId: id,
        branchId: current.branchId,
        before: { code: current.code, name: current.name, plan: current.plan, sortOrder: current.sortOrder, isActive: current.isActive },
        after: data,
        actor,
      });
    });
    return (await this.halls.findById(id))!;
  }
}

/** Логическое удаление зала — только пустого (места сначала переносятся или удаляются). */
@Injectable()
export class DeleteHall {
  constructor(
    private readonly halls: HallRepository,
    private readonly venues: VenueRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    const current = await this.halls.findById(id);
    if (!current) throw new NotFoundError('hall', id);
    actor.assertCan(Permission.VenuesManage, current.branchId);
    await this.database.transaction(async () => {
      if ((await this.venues.countByHall(id)) > 0) {
        throw new ConflictError('reservation.hall_not_empty', 'Hall still has venues', { id });
      }
      await this.halls.softDelete(id, this.clock.now());
      await this.audit.record({
        action: 'reservation.hall_deleted',
        entityType: 'hall',
        entityId: id,
        branchId: current.branchId,
        before: { code: current.code, name: current.name },
        after: null,
        actor,
      });
    });
  }
}
