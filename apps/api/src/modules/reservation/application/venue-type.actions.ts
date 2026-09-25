import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, NotFoundError } from '../../../shared/kernel/errors';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { assertTranslatable, normalizeTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { normalizeTypeCode } from '../domain/venue';
import { validateRules, VenueRules } from '../domain/venue-rules';
import { VenueTypeRecord, VenueTypeRepository, VenueTypeWrite } from '../infrastructure/venue-type.repository';
import { VenueRepository } from '../infrastructure/venue.repository';

export interface VenueTypeInput {
  code: string;
  name: Translatable;
  description?: Translatable | null;
  rules: VenueRules;
  sortOrder?: number;
  isActive?: boolean;
}

export type VenueTypePatch = Partial<Omit<VenueTypeInput, 'rules'>> & { rules?: Partial<VenueRules> };

/**
 * Справочник типов мест (стол, VIP-зал, юрта, терраса...) — общий для сети, не зашит в код.
 * Правила типа — значения по умолчанию для мест (место может переопределить любое правило).
 * Изменение справочника — только с глобальным правом venues.manage.
 */
function toWrite(input: VenueTypeInput): VenueTypeWrite {
  return {
    code: normalizeTypeCode(input.code),
    name: assertTranslatable(input.name, 'name'),
    description: normalizeTranslatable((input.description ?? {}) as Record<string, unknown>),
    rules: validateRules(input.rules),
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
  };
}

async function assertUniqueCode(types: VenueTypeRepository, code: string, exceptId?: string): Promise<void> {
  const existing = await types.findByCode(code);
  if (existing && existing.id !== exceptId) {
    throw new ConflictError('reservation.venue_type_duplicate', 'Venue type with this code already exists', { code });
  }
}

@Injectable()
export class CreateVenueType {
  constructor(
    private readonly types: VenueTypeRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, input: VenueTypeInput): Promise<VenueTypeRecord> {
    actor.assertCan(Permission.VenuesManage);
    const data = toWrite(input);
    const id = newId();
    await this.database.transaction(async () => {
      await assertUniqueCode(this.types, data.code);
      await this.types.insert(id, data);
      await this.audit.record({ action: 'reservation.venue_type_created', entityType: 'venue_type', entityId: id, after: data, actor });
    });
    return (await this.types.findById(id))!;
  }
}

@Injectable()
export class UpdateVenueType {
  constructor(
    private readonly types: VenueTypeRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
  ) {}

  async execute(actor: Actor, id: string, patch: VenueTypePatch): Promise<VenueTypeRecord> {
    actor.assertCan(Permission.VenuesManage);
    const current = await this.types.findById(id);
    if (!current) throw new NotFoundError('venue_type', id);
    const data = toWrite({
      code: patch.code ?? current.code,
      name: patch.name ?? current.name,
      description: patch.description === undefined ? current.description : patch.description,
      rules: { ...current.rules, ...(patch.rules ?? {}) },
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.isActive ?? current.isActive,
    });
    await this.database.transaction(async () => {
      await assertUniqueCode(this.types, data.code, id);
      await this.types.update(id, data);
      await this.audit.record({
        action: 'reservation.venue_type_updated',
        entityType: 'venue_type',
        entityId: id,
        before: { code: current.code, name: current.name, rules: current.rules, sortOrder: current.sortOrder, isActive: current.isActive },
        after: data,
        actor,
      });
    });
    return (await this.types.findById(id))!;
  }
}

/** Логическое удаление типа — только если нет мест этого типа (иначе — деактивировать). */
@Injectable()
export class DeleteVenueType {
  constructor(
    private readonly types: VenueTypeRepository,
    private readonly venues: VenueRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, id: string): Promise<void> {
    actor.assertCan(Permission.VenuesManage);
    const current = await this.types.findById(id);
    if (!current) throw new NotFoundError('venue_type', id);
    await this.database.transaction(async () => {
      if ((await this.venues.countByType(id)) > 0) {
        throw new ConflictError('reservation.venue_type_in_use', 'Venue type is used by venues; deactivate it instead', { id });
      }
      await this.types.softDelete(id, this.clock.now());
      await this.audit.record({
        action: 'reservation.venue_type_deleted',
        entityType: 'venue_type',
        entityId: id,
        before: { code: current.code, name: current.name, isActive: current.isActive },
        after: null,
        actor,
      });
    });
  }
}
