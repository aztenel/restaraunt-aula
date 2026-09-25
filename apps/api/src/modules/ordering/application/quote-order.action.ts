import { Injectable } from '@nestjs/common';
import { Clock } from '../../../shared/kernel/clock';
import { ValidationError } from '../../../shared/kernel/errors';
import { assertGeoPoint, GeoPoint } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { tryNormalizePhone } from '../../../shared/kernel/phone';
import { PricedLineRequest } from '../../catalog/public';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { CertificateBalanceView } from '../../payments/public';
import { DeliveryZoneState } from '../domain/delivery-zone';
import { MAX_ORDER_LINES } from '../domain/order';
import { assertBranchAcceptsOrder } from '../domain/order-rules';
import { planCheckoutPayments } from '../domain/payment-plan';
import { TotalsBreakdown } from '../domain/totals';
import { OrderType } from '../public';
import { branchOrderingSettings } from './order-branch';
import { OrderCertificateCheck } from './order-certificate';
import { OrderPricing, PricingLineResult } from './order-pricing';

export interface QuoteOrderInput {
  branchId: string;
  type: OrderType;
  items: PricedLineRequest[];
  point?: GeoPoint | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  /** Телефон гостя (если уже введён) — для лимита промокода на один телефон. */
  phone?: string | null;
}

export interface QuotePromo {
  code: string;
  applied: boolean;
  /** Машинный код причины, если не применён: promo.not_found, promo.expired, promo.min_subtotal, ... */
  reason: string | null;
  details: Record<string, unknown> | null;
  discount: Money;
  freeDelivery: boolean;
}

export interface QuoteDelivery {
  pointProvided: boolean;
  deliverable: boolean;
  zone: DeliveryZoneState | null;
  minOrderReached: boolean;
}

export interface QuoteCertificate {
  applied: boolean;
  reason: string | null;
  certificate: CertificateBalanceView | null;
  /** Сколько будет списано с сертификата. */
  amount: Money;
}

export interface QuoteResult {
  branch: BranchInfo;
  type: OrderType;
  lines: PricingLineResult[];
  breakdown: TotalsBreakdown;
  delivery: QuoteDelivery | null;
  promo: QuotePromo | null;
  certificate: QuoteCertificate | null;
  /** К оплате онлайн или при получении (итог минус сертификат). */
  amountDue: Money;
  /** Что мешает оформить заказ (машинные коды). Пусто — можно оформлять. */
  problems: string[];
}

/**
 * Расчёт корзины (витрина и оператор): сервер считает позиции по меню филиала, скидку промокода,
 * стоимость доставки по зоне и минимальную сумму, предпросмотр списания сертификата и итог.
 * Фронтенд денег не считает. Недоступные позиции не прерывают расчёт — у позиции указывается проблема.
 */
@Injectable()
export class QuoteOrder {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly pricing: OrderPricing,
    private readonly certificates: OrderCertificateCheck,
    private readonly clock: Clock,
  ) {}

  async execute(input: QuoteOrderInput): Promise<QuoteResult> {
    const branch = await this.branches.get(input.branchId);
    assertBranchAcceptsOrder(branchOrderingSettings(branch), input.type);
    if (input.items.length > MAX_ORDER_LINES) {
      throw new ValidationError('order.too_many_lines', `Order may contain at most ${MAX_ORDER_LINES} lines`);
    }
    const point = input.type === 'delivery' && input.point ? assertGeoPoint(input.point) : null;
    const result = await this.pricing.price({
      branchId: branch.id,
      type: input.type,
      lines: input.items,
      point,
      promoCode: input.promoCode ?? null,
      phone: tryNormalizePhone(input.phone),
      now: this.clock.now(),
      strict: false,
    });
    const { breakdown } = result;
    const problems: string[] = [];
    if (input.items.length === 0) problems.push('order.empty');
    for (const line of result.lines) {
      if (line.problem && !problems.includes(line.problem)) problems.push(line.problem);
    }

    let delivery: QuoteDelivery | null = null;
    if (input.type === 'delivery') {
      const minOrderReached = !breakdown.minOrderShortfall.isPositive();
      delivery = { pointProvided: point !== null, deliverable: result.zone !== null, zone: result.zone, minOrderReached };
      if (!point) problems.push('order.address_required');
      else if (!result.zone) problems.push('order.address_not_deliverable');
      else if (!minOrderReached) problems.push('order.min_order_not_reached');
    }

    let promo: QuotePromo | null = null;
    if (result.promo) {
      const evaluation = result.promo.evaluation;
      promo = evaluation.ok
        ? {
            code: result.promo.code,
            applied: true,
            reason: null,
            details: null,
            discount: breakdown.discount,
            freeDelivery: evaluation.effect.freeDelivery,
          }
        : {
            code: result.promo.code,
            applied: false,
            reason: `promo.${evaluation.reason}`,
            details: evaluation.details ?? null,
            discount: Money.zero(),
            freeDelivery: false,
          };
      if (!promo.applied) problems.push(promo.reason!);
    }

    let certificate: QuoteCertificate | null = null;
    let amountDue = breakdown.total;
    if (input.certificateCode?.trim()) {
      const check = await this.certificates.check(input.certificateCode);
      if (check.ok) {
        const plan = planCheckoutPayments(breakdown.total, check.certificate.balance);
        certificate = { applied: true, reason: null, certificate: check.certificate, amount: plan.certificate };
        amountDue = plan.remainder;
      } else {
        certificate = { applied: false, reason: check.code, certificate: check.certificate, amount: Money.zero() };
        problems.push(check.code);
      }
    }

    return { branch, type: input.type, lines: result.lines, breakdown, delivery, promo, certificate, amountDue, problems };
  }
}
