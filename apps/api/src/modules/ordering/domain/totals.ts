import { invariant } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { OrderType } from '../public';

/**
 * Расчёт сумм заказа. Итог всегда считается на сервере (правило 6 ТЗ), фронтенд только отображает.
 *
 * - subtotal — сумма позиций (Σ lineTotal);
 * - discount — скидка промокода на сумму блюд (не на доставку), не больше subtotal;
 * - deliveryFee — стоимость зоны; 0, если subtotal достиг «бесплатно от» зоны или промокод «бесплатная доставка»;
 * - total = subtotal − discount + deliveryFee, не меньше нуля.
 *
 * Пороги зоны (минимальная сумма, «бесплатно от») сравниваются с суммой блюд до скидки.
 */
export interface ZoneTerms {
  zoneId: string;
  minOrderAmount: Money;
  deliveryFee: Money;
  freeDeliveryFrom: Money | null;
  etaMinutes: number;
}

/** Эффект промокода до ограничения суммой блюд. */
export interface PromoEffect {
  discount: Money;
  freeDelivery: boolean;
}

export interface OrderTotals {
  subtotal: Money;
  discount: Money;
  deliveryFee: Money;
  total: Money;
}

export interface TotalsBreakdown extends OrderTotals {
  /** Стоимость доставки зоны до льгот. */
  baseDeliveryFee: Money;
  freeDeliveryReason: 'threshold' | 'promo' | null;
  /** Сколько не хватает до минимальной суммы зоны (0 — достигнута). */
  minOrderShortfall: Money;
  /** Сколько не хватает до бесплатной доставки (null — порога нет или уже бесплатно). */
  amountToFreeDelivery: Money | null;
}

export function computeOrderTotals(input: {
  lineTotals: readonly Money[];
  type: OrderType;
  zone: ZoneTerms | null;
  promo: PromoEffect | null;
}): TotalsBreakdown {
  const subtotal = Money.sum([...input.lineTotals]);
  invariant(!subtotal.isNegative(), 'order.negative_subtotal');
  const discount = input.promo ? input.promo.discount.clampToZero().min(subtotal) : Money.zero();

  let baseDeliveryFee = Money.zero();
  let deliveryFee = Money.zero();
  let freeDeliveryReason: TotalsBreakdown['freeDeliveryReason'] = null;
  let minOrderShortfall = Money.zero();
  let amountToFreeDelivery: Money | null = null;
  if (input.type === 'delivery' && input.zone) {
    const zone = input.zone;
    baseDeliveryFee = zone.deliveryFee;
    deliveryFee = zone.deliveryFee;
    minOrderShortfall = zone.minOrderAmount.subtract(subtotal).clampToZero();
    if (zone.freeDeliveryFrom && subtotal.greaterThanOrEqual(zone.freeDeliveryFrom)) {
      deliveryFee = Money.zero();
      freeDeliveryReason = 'threshold';
    } else if (input.promo?.freeDelivery) {
      deliveryFee = Money.zero();
      freeDeliveryReason = 'promo';
    } else if (zone.freeDeliveryFrom && deliveryFee.isPositive()) {
      amountToFreeDelivery = zone.freeDeliveryFrom.subtract(subtotal);
    }
  }

  const total = subtotal.subtract(discount).add(deliveryFee);
  invariant(!total.isNegative(), 'order.negative_total');
  return { subtotal, discount, deliveryFee, total, baseDeliveryFee, freeDeliveryReason, minOrderShortfall, amountToFreeDelivery };
}
