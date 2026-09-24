import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../shared/kernel/errors';
import { GeoPoint } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { MenuPricing, PricedLine, PricedLineRequest } from '../../catalog/public';
import { DeliveryZoneState, findZoneForPoint, zoneTerms } from '../domain/delivery-zone';
import { evaluatePromo, normalizePromoCode, PromoCodeState, PromoEvaluation, PromoRejection } from '../domain/promo-code';
import { computeOrderTotals, TotalsBreakdown } from '../domain/totals';
import { DeliveryZoneRepository } from '../infrastructure/delivery-zone.repository';
import { PromoCodeRepository } from '../infrastructure/promo-code.repository';
import { OrderType } from '../public';

export interface PricingLineResult {
  index: number;
  request: PricedLineRequest;
  priced: PricedLine | null;
  /** Машинный код проблемы позиции (catalog.dish_unavailable, catalog.modifier_invalid, ...). */
  problem: string | null;
}

export interface PricingPromoResult {
  code: string;
  promo: PromoCodeState | null;
  evaluation: PromoEvaluation;
}

export interface PricingResult {
  lines: PricingLineResult[];
  priced: PricedLine[];
  zone: DeliveryZoneState | null;
  promo: PricingPromoResult | null;
  breakdown: TotalsBreakdown;
}

export interface PricingInput {
  branchId: string;
  type: OrderType;
  lines: PricedLineRequest[];
  point: GeoPoint | null;
  promoCode: string | null;
  /** Нормализованный телефон — для лимита промокода на один телефон (null — неизвестен). */
  phone: string | null;
  now: Date;
  /**
   * strict — оформление: ошибка любой позиции прерывает оформление (ValidationError каталога).
   * Иначе — расчёт корзины: проблемы собираются по каждой позиции.
   */
  strict: boolean;
  /** Блокировать строку промокода до конца транзакции (лимиты использований при оформлении). */
  lockPromo?: boolean;
}

/**
 * Серверный расчёт заказа: позиции по актуальному меню филиала (MenuPricing), зона доставки по точке,
 * промокод по правилам, суммы. Используется и расчётом корзины, и оформлением — фронтенд денег не считает.
 */
@Injectable()
export class OrderPricing {
  constructor(
    private readonly menu: MenuPricing,
    private readonly zones: DeliveryZoneRepository,
    private readonly promos: PromoCodeRepository,
  ) {}

  async price(input: PricingInput): Promise<PricingResult> {
    const lines = await this.priceLines(input);
    const priced = lines.map((l) => l.priced).filter((p): p is PricedLine => p !== null);
    const subtotal = Money.sum(priced.map((p) => p.lineTotal));

    let zone: DeliveryZoneState | null = null;
    if (input.type === 'delivery' && input.point) {
      zone = findZoneForPoint(input.point, await this.zones.listForBranch(input.branchId, { activeOnly: true }));
    }

    let promo: PricingPromoResult | null = null;
    const code = input.promoCode ? normalizePromoCode(input.promoCode) : '';
    if (code) {
      const state = await this.promos.findByCode(code, { forUpdate: input.lockPromo ?? false });
      const evaluation: PromoEvaluation = state
        ? evaluatePromo(state, {
            now: input.now,
            branchId: input.branchId,
            type: input.type,
            subtotal,
            usage: await this.promos.usageCounts(state.id, input.phone),
          })
        : { ok: false, reason: PromoRejection.NotFound };
      promo = { code, promo: state, evaluation };
    }

    const breakdown = computeOrderTotals({
      lineTotals: priced.map((p) => p.lineTotal),
      type: input.type,
      zone: zone ? zoneTerms(zone) : null,
      promo: promo?.evaluation.ok ? promo.evaluation.effect : null,
    });
    return { lines, priced, zone, promo, breakdown };
  }

  private async priceLines(input: PricingInput): Promise<PricingLineResult[]> {
    if (input.strict) {
      const priced = await this.menu.priceLines(input.branchId, input.lines);
      return priced.map((p, index) => ({ index, request: input.lines[index]!, priced: p, problem: null }));
    }
    try {
      const priced = await this.menu.priceLines(input.branchId, input.lines);
      return priced.map((p, index) => ({ index, request: input.lines[index]!, priced: p, problem: null }));
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
    }
    // Хотя бы одна позиция не проходит — считаем по одной, чтобы показать проблему у каждой.
    const result: PricingLineResult[] = [];
    for (const [index, request] of input.lines.entries()) {
      try {
        const [priced] = await this.menu.priceLines(input.branchId, [request]);
        result.push({ index, request, priced: priced ?? null, problem: priced ? null : 'catalog.dish_not_in_branch_menu' });
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        result.push({ index, request, priced: null, problem: err.code });
      }
    }
    return result;
  }
}
