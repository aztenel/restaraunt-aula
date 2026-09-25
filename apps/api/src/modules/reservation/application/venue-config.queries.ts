import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { ForbiddenError, NotFoundError } from '../../../shared/kernel/errors';
import { Permission } from '../../../shared/kernel/permissions';
import { Translatable } from '../../../shared/kernel/translatable';
import { BranchDirectory } from '../../identity/public';
import { HallRepository } from '../infrastructure/hall.repository';
import { ReservationSettingsRepository } from '../infrastructure/settings.repository';
import { VenueTypeRepository } from '../infrastructure/venue-type.repository';
import { VenueRepository } from '../infrastructure/venue.repository';
import { HallView, ReservationViewMapper, VenueTypeView, VenueView } from './reservation-views';

export interface ReservationSettingsView {
  branchId: string;
  reminderHoursBefore: number;
  minLeadMinutes: number;
  maxDaysAhead: number;
  policyText: Translatable;
  updatedAt: Date | null;
}

/**
 * Конфигурация залов в админке (чтение): типы мест — общий справочник; залы и места — по филиалам
 * (право venues.manage или reservations.view в филиале: оператору нужна карта зала).
 */
const CONFIG_VIEW = [Permission.VenuesManage, Permission.ReservationsView] as const;

function scopeForConfig(actor: Actor, branchId?: string): 'all' | string[] {
  const allowed = CONFIG_VIEW.map((perm) => actor.branchesWith(perm));
  const merged = allowed.includes('all') ? 'all' : [...new Set((allowed as string[][]).flat())];
  if (branchId) {
    if (merged !== 'all' && !merged.includes(branchId)) {
      throw new ForbiddenError('access.forbidden_branch', 'No access to this branch', { branchId });
    }
    return [branchId];
  }
  if (merged !== 'all' && merged.length === 0) {
    throw new ForbiddenError('access.forbidden', `Permission ${Permission.VenuesManage} required`, { permission: Permission.VenuesManage });
  }
  return merged;
}

@Injectable()
export class VenueConfigQueries {
  constructor(
    private readonly types: VenueTypeRepository,
    private readonly halls: HallRepository,
    private readonly venues: VenueRepository,
    private readonly settings: ReservationSettingsRepository,
    private readonly branches: BranchDirectory,
    private readonly views: ReservationViewMapper,
  ) {}

  async venueTypes(actor: Actor): Promise<VenueTypeView[]> {
    scopeForConfig(actor);
    return (await this.types.list()).map((t) => this.views.venueType(t));
  }

  async venueType(actor: Actor, id: string): Promise<VenueTypeView> {
    scopeForConfig(actor);
    const type = await this.types.findById(id);
    if (!type) throw new NotFoundError('venue_type', id);
    return this.views.venueType(type);
  }

  async hallList(actor: Actor, branchId?: string): Promise<HallView[]> {
    const branchIds = scopeForConfig(actor, branchId);
    return (await this.halls.list({ branchIds })).map((h) => this.views.hall(h));
  }

  async hall(actor: Actor, id: string): Promise<HallView> {
    const hall = await this.halls.findById(id);
    if (!hall) throw new NotFoundError('hall', id);
    scopeForConfig(actor, hall.branchId);
    return this.views.hall(hall);
  }

  async venueList(actor: Actor, filter: { branchId?: string; hallId?: string; typeId?: string }): Promise<VenueView[]> {
    const branchIds = scopeForConfig(actor, filter.branchId);
    const venues = await this.venues.listDetailed({ branchIds, hallId: filter.hallId, typeId: filter.typeId });
    return venues.map((v) => this.views.venue(v));
  }

  async venue(actor: Actor, id: string): Promise<VenueView> {
    const venue = await this.venues.findDetailed(id);
    if (!venue) throw new NotFoundError('venue', id);
    scopeForConfig(actor, venue.branchId);
    return this.views.venue(venue);
  }

  async branchSettings(actor: Actor, branchId: string): Promise<ReservationSettingsView> {
    scopeForConfig(actor, branchId);
    if (!(await this.branches.find(branchId))) throw new NotFoundError('branch', branchId);
    const found = await this.settings.find(branchId);
    const current = await this.settings.get(branchId);
    return { branchId, ...current, updatedAt: found?.updatedAt ?? null };
  }
}
