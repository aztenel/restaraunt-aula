import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Money } from '../../../shared/kernel/money';
import { Permission } from '../../../shared/kernel/permissions';
import { assertTranslatable, normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { normalizeVenueCode, validateCapacity, validateDeposit, validatePosition, VenuePosition } from '../domain/venue';
import { validateOverrides } from '../domain/venue-rules';
import { HallRecord, HallRepository } from '../infrastructure/hall.repository';
import { ReservationRepository } from '../infrastructure/reservation.repository';
import { VenueTypeRepository } from '../infrastructure/venue-type.repository';
import { VenueDetails, VenueRecord, VenueRepository, VenueWrite } from '../infrastructure/venue.repository';

export interface VenueInput {
  hallId: string;
  typeId: string;
  code: string;
  name: Translatable;
  description?: Translatable | null;
  capacityMin: number;
  capacityMax: number;
  /** Минимальный депозит; null — без депозита. */
  deposit?: Money | null;
  /** Переопределения правил типа (null у ключа — «как у типа»). */
  rules?: Record<string, unknown> | null;
  position?: Partial<VenuePosition>;
  sortOrder?: number;
  isActive?: boolean;
}

export type VenuePatch = Partial<VenueInput>;

export const DEFAULT_POSITION: VenuePosition = { x: 0, y: 0, w: 60, h: 60, shape: 'rect', rotation: 0 };

function auditView(v: VenueRecord | VenueWrite) {
  return {
    hallId: v.hallId,
    typeId: v.typeId,
    code: v.code,
    name: v.name,
    capacityMin: v.capacityMin,
    capacityMax: v.capacityMax,
    deposit: v.deposit?.toJSON() ?? null,
    rules: v.ruleOverrides,
    position: v.position,
    sortOrder: v.sortOrder,
    isActive: v.isActive,
  };
}

/** Проверка и нормализация места (вместимость, депозит, правила, позиция внутри плана зала). */
async function toWrite(input: VenueInput, hall: HallRecord, types: VenueTypeRepository): Promise<VenueWrite> {
  if (!(await types.findById(input.typeId))) throw new ValidationError('reservation.unknown_venue_type', 'Venue type not found', { typeId: input.typeId });
  validateCapacity(input.capacityMin, input.capacityMax);
  return {
    branchId: hall.branchId,
    hallId: hall.id,
    typeId: input.typeId,
    code: normalizeVenueCode(input.code),
    name: assertTranslatable(input.name, 'name'),
    description: normalizeTranslatable((input.description ?? {}) as Record<string, unknown>),
    capacityMin: input.capacityMin,
    capacityMax: input.capacityMax,
    deposit: validateDeposit(input.deposit ?? null),
    ruleOverrides: validateOverrides(input.rules ?? null),
    position: validatePosition({ ...DEFAULT_POSITION, ...(input.position ?? {}) }, hall.plan),
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  };
}

async function assertUniqueCode(venues: VenueRepository, branchId: string, code: string, exceptId?: string): Promise<void> {
  const existing = await venues.findByCode(branchId, code);
  if (existing && existing.id !== exceptId) {
    throw new ConflictError('reservation.venue_duplicate', 'Venue with this code already exists in the branch', { code });
  }
}

/** Места: стол, VIP-зал, юрта... Право venues.manage в филиале зала. */
@Injectable()
export class CreateVenue {
  constructor(
    private readonly venues: VenueRepository,
    private readonly halls: HallRepository,
    private readonly types: VenueTypeRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: VenueInput): Promise<VenueDetails> {
    const hall = await this.halls.findById(input.hallId);
    if (!hall) throw new ValidationError('reservation.unknown_hall', 'Hall not found', { hallId: input.hallId });
    actor.assertCan(Permission.VenuesManage, hall.branchId);
    const data = await toWrite(input, hall, this.types);
    const id = newId();
    await this.database.transaction(async () => {
      await assertUniqueCode(this.venues, data.branchId, data.code);
      await this.venues.insert(id, data);
      await this.audit.record({
        action: 'reservation.venue_created',
        entityType: 'venue',
        entityId: id,
        branchId: data.branchId,
        after: auditView(data),
        actor,
      });
    });
    return (await this.venues.findDetailed(id))!;
  }
}

@Injectable()
export class UpdateVenue {
  constructor(
    private readonly venues: VenueRepository,
    private readonly halls: HallRepository,
    private readonly types: VenueTypeRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, patch: VenuePatch): Promise<VenueDetails> {
    const current = await this.venues.findById(id);
    if (!current) throw new NotFoundError('venue', id);
    actor.assertCan(Permission.VenuesManage, current.branchId);
    const hall = await this.halls.findById(patch.hallId ?? current.hallId);
    if (!hall) throw new ValidationError('reservation.unknown_hall', 'Hall not found', { hallId: patch.hallId });
    if (hall.branchId !== current.branchId) {
      throw new ValidationError('reservation.hall_other_branch', 'Venue can be moved only to a hall of the same branch');
    }
    const data = await toWrite(
      {
        hallId: hall.id,
        typeId: patch.typeId ?? current.typeId,
        code: patch.code ?? current.code,
        name: patch.name ?? current.name,
        description: patch.description === undefined ? current.description : patch.description,
        capacityMin: patch.capacityMin ?? current.capacityMin,
        capacityMax: patch.capacityMax ?? current.capacityMax,
        deposit: patch.deposit === undefined ? current.deposit : patch.deposit,
        rules: patch.rules === undefined ? current.ruleOverrides : patch.rules,
        position: { ...current.position, ...(patch.position ?? {}) },
        sortOrder: patch.sortOrder ?? current.sortOrder,
        isActive: patch.isActive ?? current.isActive,
      },
      hall,
      this.types,
    );
    await this.database.transaction(async () => {
      await assertUniqueCode(this.venues, data.branchId, data.code, id);
      await this.venues.update(id, data);
      await this.audit.record({
        action: 'reservation.venue_updated',
        entityType: 'venue',
        entityId: id,
        branchId: current.branchId,
        before: auditView(current),
        after: auditView(data),
        actor,
      });
    });
    return (await this.venues.findDetailed(id))!;
  }
}

/** Логическое удаление места — только без предстоящих броней (их сначала переносят или отменяют). */
@Injectable()
export class DeleteVenue {
  constructor(
    private readonly venues: VenueRepository,
    private readonly reservations: ReservationRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    const current = await this.venues.findById(id);
    if (!current) throw new NotFoundError('venue', id);
    actor.assertCan(Permission.VenuesManage, current.branchId);
    await this.database.transaction(async () => {
      // Блокировка места: параллельная бронь не проскочит между проверкой и удалением.
      await this.venues.lockForUpdate([id]);
      if (await this.reservations.hasUpcomingForVenue(id, this.clock.now())) {
        throw new ConflictError('reservation.venue_has_reservations', 'Venue has upcoming reservations; move or cancel them first', { id });
      }
      await this.venues.softDelete(id, this.clock.now());
      await this.audit.record({
        action: 'reservation.venue_deleted',
        entityType: 'venue',
        entityId: id,
        branchId: current.branchId,
        before: auditView(current),
        after: null,
        actor,
      });
    });
  }
}
