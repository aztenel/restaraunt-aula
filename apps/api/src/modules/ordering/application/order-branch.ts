import { BranchInfo } from '../../identity/public';
import { BranchOrderingSettings, leadMinutesFor } from '../domain/order-rules';
import { ScheduleRules } from '../domain/scheduling';
import { OrderType } from '../public';

/** Настройки филиала в терминах правил оформления (domain/order-rules). */
export function branchOrderingSettings(branch: BranchInfo): BranchOrderingSettings {
  return {
    isActive: branch.isActive,
    acceptsDelivery: branch.settings.acceptsDelivery,
    acceptsPickup: branch.settings.acceptsPickup,
    paymentMethods: branch.settings.paymentMethods,
    deliveryLeadMinutes: branch.settings.deliveryLeadMinutes,
    pickupLeadMinutes: branch.settings.pickupLeadMinutes,
  };
}

/** Правила времени заказа филиала для типа заказа (domain/scheduling). */
export function scheduleRulesFor(branch: BranchInfo, type: OrderType): ScheduleRules {
  return {
    openingHours: branch.openingHours,
    timezone: branch.timezone,
    leadMinutes: leadMinutesFor(branch.settings, type),
    maxScheduleDaysAhead: branch.settings.maxScheduleDaysAhead,
  };
}
