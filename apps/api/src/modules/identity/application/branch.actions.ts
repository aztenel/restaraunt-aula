import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { assertGeoPoint, GeoPoint } from '../../../shared/kernel/geo';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { normalizePhone } from '../../../shared/kernel/phone';
import { OpeningHours, validateOpeningHours } from '../../../shared/kernel/time';
import { assertTranslatable, Translatable } from '../../../shared/kernel/translatable';
import { BranchWrite, BranchRepository } from '../infrastructure/branch.repository';
import { LegalEntityRepository } from '../infrastructure/legal-entity.repository';
import { BranchInfo, BranchSettings, DEFAULT_BRANCH_SETTINGS } from '../public/branch-directory';
import { IdentityEvents } from '../public/events';

export interface BranchInput {
  code: string;
  slug: string;
  name: Translatable;
  address: Translatable;
  location: GeoPoint;
  phone: string;
  whatsapp?: string | null;
  email?: string | null;
  timezone?: string;
  openingHours: OpeningHours;
  settings?: Partial<BranchSettings>;
  legalEntityId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
}

function validateSettings(settings: BranchSettings): BranchSettings {
  const positive = ['deliveryLeadMinutes', 'pickupLeadMinutes', 'maxScheduleDaysAhead', 'awaitingPaymentTimeoutMinutes'] as const;
  for (const key of positive) {
    if (!Number.isInteger(settings[key]) || settings[key] < 0 || settings[key] > 10_000) {
      throw new ValidationError('branch.invalid_setting', `Invalid ${key}`, { key });
    }
  }
  if (settings.paymentMethods.length === 0) {
    throw new ValidationError('branch.no_payment_methods', 'At least one payment method is required');
  }
  if (settings.staffNotifyPhone) settings.staffNotifyPhone = normalizePhone(settings.staffNotifyPhone);
  return settings;
}

async function toWrite(input: BranchInput, current: BranchInfo | null, legalEntities: LegalEntityRepository): Promise<BranchWrite> {
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,6}$/.test(code)) throw new ValidationError('branch.invalid_code', 'Code: 1-6 latin letters/digits');
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new ValidationError('branch.invalid_slug', 'Slug: latin, digits, dashes');
  if (input.legalEntityId && !(await legalEntities.findById(input.legalEntityId))) {
    throw new ValidationError('branch.unknown_legal_entity', 'Legal entity not found');
  }
  const timezone = input.timezone ?? current?.timezone ?? 'Asia/Almaty';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ValidationError('branch.invalid_timezone', 'Unknown timezone');
  }
  return {
    code,
    slug,
    name: assertTranslatable(input.name, 'name'),
    address: assertTranslatable(input.address, 'address'),
    location: assertGeoPoint(input.location),
    phone: normalizePhone(input.phone),
    whatsapp: input.whatsapp ? normalizePhone(input.whatsapp) : null,
    email: input.email?.trim() || null,
    timezone,
    openingHours: validateOpeningHours(input.openingHours),
    settings: validateSettings({ ...DEFAULT_BRANCH_SETTINGS, ...(current?.settings ?? {}), ...(input.settings ?? {}) }),
    legalEntityId: input.legalEntityId ?? null,
    isActive: input.isActive ?? current?.isActive ?? true,
    sortOrder: input.sortOrder ?? current?.sortOrder ?? 0,
  };
}

@Injectable()
export class CreateBranch {
  constructor(
    private readonly branches: BranchRepository,
    private readonly legalEntities: LegalEntityRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
  ) {}

  async execute(actor: Actor, input: BranchInput): Promise<BranchInfo> {
    actor.assertCan(Permission.BranchesManage);
    const data = await toWrite(input, null, this.legalEntities);
    if (await this.branches.findByCodeOrSlug(data.code, data.slug)) {
      throw new ConflictError('branch.duplicate', 'Branch with this code or slug already exists');
    }
    const id = newId();
    await this.database.transaction(async () => {
      await this.branches.insert(id, data);
      await this.audit.record({ action: 'branch.created', entityType: 'branch', entityId: id, branchId: id, after: data });
      await this.events.publish(IdentityEvents.BranchChanged, { branchId: id }, { aggregateId: id, branchId: id });
    });
    return (await this.branches.findById(id))!;
  }
}

@Injectable()
export class UpdateBranch {
  constructor(
    private readonly branches: BranchRepository,
    private readonly legalEntities: LegalEntityRepository,
    private readonly database: Database,
    private readonly audit: AuditLog,
    private readonly events: EventBus,
  ) {}

  async execute(actor: Actor, branchId: string, input: BranchInput): Promise<BranchInfo> {
    actor.assertCan(Permission.BranchesManage, branchId);
    const current = await this.branches.findById(branchId);
    if (!current) throw new NotFoundError('branch', branchId);
    const data = await toWrite(input, current, this.legalEntities);
    if (await this.branches.findByCodeOrSlug(data.code, data.slug, branchId)) {
      throw new ConflictError('branch.duplicate', 'Branch with this code or slug already exists');
    }
    await this.database.transaction(async () => {
      await this.branches.update(branchId, data);
      await this.audit.record({
        action: 'branch.updated',
        entityType: 'branch',
        entityId: branchId,
        branchId,
        before: current,
        after: data,
      });
      await this.events.publish(IdentityEvents.BranchChanged, { branchId }, { aggregateId: branchId, branchId });
    });
    return (await this.branches.findById(branchId))!;
  }
}
