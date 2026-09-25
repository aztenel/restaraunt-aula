import { ValidationError } from '../../../shared/kernel/errors';
import { OrderType } from '../public';
import { PaymentMethodChoice } from './order';

/**
 * Правила оформления, зависящие от настроек филиала (docs/decisions.md): филиал активен, принимает
 * выбранный тип заказа и способ оплаты; время приготовления — deliveryLeadMinutes / pickupLeadMinutes.
 */
export interface BranchOrderingSettings {
  isActive: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  paymentMethods: readonly string[];
  deliveryLeadMinutes: number;
  pickupLeadMinutes: number;
}

export function assertBranchAcceptsOrder(branch: BranchOrderingSettings, type: OrderType, paymentMethod?: PaymentMethodChoice): void {
  if (!branch.isActive) {
    throw new ValidationError('order.branch_inactive', 'The branch does not accept orders');
  }
  const accepts = type === 'delivery' ? branch.acceptsDelivery : branch.acceptsPickup;
  if (!accepts) {
    throw new ValidationError('order.type_not_accepted', `The branch does not accept ${type} orders`, { type });
  }
  if (paymentMethod && !branch.paymentMethods.includes(paymentMethod)) {
    throw new ValidationError('order.payment_method_not_accepted', 'The branch does not accept this payment method', {
      paymentMethod,
      accepted: [...branch.paymentMethods],
    });
  }
}

/** Минимальное время приготовления для типа заказа, минут. */
export function leadMinutesFor(branch: Pick<BranchOrderingSettings, 'deliveryLeadMinutes' | 'pickupLeadMinutes'>, type: OrderType): number {
  return type === 'delivery' ? branch.deliveryLeadMinutes : branch.pickupLeadMinutes;
}

/**
 * Ориентировочная длительность заказа «как можно скорее», минут: самовывоз — время приготовления,
 * доставка — не меньше времени приготовления и не меньше срока доставки зоны.
 */
export function orderEtaMinutes(type: OrderType, leadMinutes: number, zoneEtaMinutes: number | null): number {
  if (type === 'pickup') return leadMinutes;
  return Math.max(leadMinutes, zoneEtaMinutes ?? 0);
}

export const MAX_COMMENT_LENGTH = 1000;

/** Текст из формы: обрезка пробелов, пустое — null, ограничение длины. */
export function cleanText(value: string | null | undefined, max = MAX_COMMENT_LENGTH): string | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  return text.length > max ? text.slice(0, max) : text;
}
