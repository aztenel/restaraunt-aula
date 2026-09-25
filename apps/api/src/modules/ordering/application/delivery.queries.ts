import { Injectable } from '@nestjs/common';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { NotFoundError, ValidationError } from '../../../shared/kernel/errors';
import { assertGeoPoint, GeoPoint } from '../../../shared/kernel/geo';
import { Permission } from '../../../shared/kernel/permissions';
import { isIsoDate, toLocalDate } from '../../../shared/kernel/time';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { DeliveryZoneState, rankDeliveryCandidates } from '../domain/delivery-zone';
import { assertBranchAcceptsOrder } from '../domain/order-rules';
import { AsapAvailability, asapAvailability, orderSlots, schedulableDates } from '../domain/scheduling';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';
import { OrderType } from '../public';
import { branchOrderingSettings, scheduleRulesFor } from './order-branch';

export interface DeliveryOption {
  branch: BranchInfo;
  zone: DeliveryZoneState;
  distanceMeters: number;
}

export interface DeliveryResolution {
  deliverable: boolean;
  /** Выбранный филиал и зона (меньшая стоимость доставки, затем ближайший филиал). */
  best: DeliveryOption | null;
  /** Другие филиалы, которые тоже доставляют в эту точку. */
  alternatives: DeliveryOption[];
}

export interface OrderSlotsView {
  branch: BranchInfo;
  type: OrderType;
  date: string;
  leadMinutes: number;
  asap: AsapAvailability;
  slots: Date[];
  dates: string[];
}

/**
 * Запросы доставки для витрины и админки: выбор филиала по точке (геокодирование — в браузере витрины,
 * сервер внешних вызовов не делает), зоны филиала для карты, время заказа (ASAP и слоты по 15 минут).
 */
@Injectable()
export class DeliveryQueries {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly zones: DeliveryZoneRepository,
    private readonly clock: Clock,
  ) {}

  async resolve(point: GeoPoint): Promise<DeliveryResolution> {
    const p = assertGeoPoint(point);
    const branches = (await this.branches.list({ activeOnly: true })).filter((b) => b.isActive && b.settings.acceptsDelivery);
    const byId = new Map(branches.map((b) => [b.id, b]));
    const zones = await this.zones.listForBranches(
      branches.map((b) => b.id),
      { activeOnly: true },
    );
    const ranked = rankDeliveryCandidates(
      p,
      zones.map((zone) => ({ zone, branchLocation: byId.get(zone.branchId)!.location, branchSortOrder: byId.get(zone.branchId)!.sortOrder })),
    );
    const options = ranked.map((r) => ({ branch: byId.get(r.zone.branchId)!, zone: r.zone, distanceMeters: r.distanceMeters }));
    return { deliverable: options.length > 0, best: options[0] ?? null, alternatives: options.slice(1) };
  }

  /** Активные зоны филиала (карта на витрине). */
  async publicZones(branchId: string): Promise<{ branch: BranchInfo; zones: DeliveryZoneState[] }> {
    const branch = await this.branches.find(branchId);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', branchId);
    return { branch, zones: branch.settings.acceptsDelivery ? await this.zones.listForBranch(branchId, { activeOnly: true }) : [] };
  }

  /** Все зоны филиалов, где у сотрудника есть право управлять зонами. */
  async adminZones(actor: Actor, branchId?: string | null): Promise<DeliveryZoneState[]> {
    const scope = actor.scopeBranches(Permission.DeliveryZonesManage, branchId ?? null);
    return this.zones.listForBranches(scope);
  }

  async adminZone(actor: Actor, zoneId: string): Promise<DeliveryZoneState> {
    const zone = await this.zones.findById(zoneId);
    if (!zone) throw new NotFoundError('delivery_zone', zoneId);
    actor.assertCan(Permission.DeliveryZonesManage, zone.branchId);
    return zone;
  }

  async orderSlots(branchId: string, type: OrderType, date?: string | null): Promise<OrderSlotsView> {
    const branch = await this.branches.find(branchId);
    if (!branch || !branch.isActive) throw new NotFoundError('branch', branchId);
    assertBranchAcceptsOrder(branchOrderingSettings(branch), type);
    const now = this.clock.now();
    const rules = scheduleRulesFor(branch, type);
    const day = date ?? toLocalDate(now, branch.timezone);
    if (!isIsoDate(day)) throw new ValidationError('order.invalid_date', 'Date must be YYYY-MM-DD', { date: day });
    return {
      branch,
      type,
      date: day,
      leadMinutes: rules.leadMinutes,
      asap: asapAvailability(rules, now),
      slots: orderSlots(rules, now, day),
      dates: schedulableDates(rules, now),
    };
  }
}
