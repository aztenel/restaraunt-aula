import { ValidationError } from '../../../shared/kernel/errors';
import { Money } from '../../../shared/kernel/money';
import { OrderType } from '../public';
import { PromoEffect } from './totals';

/**
 * Промокоды (docs/decisions.md): процент, фиксированная сумма или бесплатная доставка; минимальная сумма
 * заказа; срок действия; лимит использований всего и на один телефон; ограничение по филиалу.
 * Один промокод на заказ. Скидка — на сумму блюд (не на доставку, кроме «бесплатной доставки»)
 * и не больше неё. Использование фиксируется при оформлении и освобождается при отмене до оплаты.
 */
export const PromoKind = {
  Percent: 'percent',
  Fixed: 'fixed',
  FreeDelivery: 'free_delivery',
} as const;
export type PromoKind = (typeof PromoKind)[keyof typeof PromoKind];
export const PROMO_KINDS = Object.values(PromoKind);

export const PromoUsageStatus = {
  Reserved: 'reserved',
  Used: 'used',
  Released: 'released',
} as const;
export type PromoUsageStatus = (typeof PromoUsageStatus)[keyof typeof PromoUsageStatus];

/** Причины, по которым промокод не применяется (машинные коды: promo.<reason>). */
export const PromoRejection = {
  NotFound: 'not_found',
  Inactive: 'inactive',
  NotStarted: 'not_started',
  Expired: 'expired',
  WrongBranch: 'wrong_branch',
  MinSubtotal: 'min_subtotal',
  TotalLimitReached: 'total_limit_reached',
  PhoneLimitReached: 'phone_limit_reached',
  NotApplicable: 'not_applicable',
} as const;
export type PromoRejection = (typeof PromoRejection)[keyof typeof PromoRejection];

export interface PromoCodeDefinition {
  code: string;
  description: string | null;
  kind: PromoKind;
  /** Для percent: доля в базисных пунктах (10% = 1000). */
  percentBp: number | null;
  /** Для fixed: сумма скидки. */
  fixedAmount: Money | null;
  /** Минимальная сумма блюд, с которой действует промокод. */
  minSubtotal: Money | null;
  validFrom: Date | null;
  validTo: Date | null;
  totalLimit: number | null;
  perPhoneLimit: number | null;
  /** null — действует во всех филиалах. */
  branchId: string | null;
  isActive: boolean;
}

export interface PromoCodeState extends PromoCodeDefinition {
  id: string;
}

/** Сколько раз промокод уже использован (reserved + used, без released). */
export interface PromoUsageCounts {
  total: number;
  /** null — телефон ещё неизвестен (расчёт корзины без контактов): лимит на телефон не проверяется. */
  byPhone: number | null;
}

export interface PromoContext {
  now: Date;
  branchId: string;
  type: OrderType;
  subtotal: Money;
  usage: PromoUsageCounts;
}

export type PromoEvaluation =
  | { ok: true; effect: PromoEffect }
  | { ok: false; reason: PromoRejection; details?: Record<string, unknown> };

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

/** Код хранится и сравнивается в верхнем регистре без пробелов. */
export function normalizePromoCode(raw: string): string {
  return (raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function assertPromoCodeFormat(code: string): string {
  const normalized = normalizePromoCode(code);
  if (!CODE_RE.test(normalized)) {
    throw new ValidationError('promo.invalid_code_format', 'Promo code: 3-32 latin letters, digits, "-" or "_"', { code });
  }
  return normalized;
}

function positiveIntOrNull(value: number | null, field: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError('promo.invalid_limit', `${field} must be a positive integer`, { field });
  }
  return value;
}

/** Проверка и нормализация определения промокода (админка). */
export function validatePromoDefinition(input: PromoCodeDefinition): PromoCodeDefinition {
  const code = assertPromoCodeFormat(input.code);
  let percentBp: number | null = null;
  let fixedAmount: Money | null = null;
  if (input.kind === PromoKind.Percent) {
    if (input.percentBp === null || !Number.isSafeInteger(input.percentBp) || input.percentBp < 1 || input.percentBp > 10_000) {
      throw new ValidationError('promo.invalid_percent', 'Percent must be 1..10000 basis points (0.01%..100%)');
    }
    percentBp = input.percentBp;
  } else if (input.kind === PromoKind.Fixed) {
    if (!input.fixedAmount || !input.fixedAmount.isPositive()) {
      throw new ValidationError('promo.invalid_fixed_amount', 'Fixed discount must be positive');
    }
    fixedAmount = input.fixedAmount;
  } else if (input.kind !== PromoKind.FreeDelivery) {
    throw new ValidationError('promo.invalid_kind', 'Unknown promo kind', { kind: input.kind });
  }
  if (input.minSubtotal && input.minSubtotal.isNegative()) {
    throw new ValidationError('promo.invalid_min_subtotal', 'Minimal subtotal must not be negative');
  }
  if (input.validFrom && input.validTo && input.validFrom.getTime() >= input.validTo.getTime()) {
    throw new ValidationError('promo.invalid_period', 'validFrom must be before validTo');
  }
  return {
    code,
    description: input.description?.trim() || null,
    kind: input.kind,
    percentBp,
    fixedAmount,
    minSubtotal: input.minSubtotal && input.minSubtotal.isPositive() ? input.minSubtotal : null,
    validFrom: input.validFrom,
    validTo: input.validTo,
    totalLimit: positiveIntOrNull(input.totalLimit, 'totalLimit'),
    perPhoneLimit: positiveIntOrNull(input.perPhoneLimit, 'perPhoneLimit'),
    branchId: input.branchId,
    isActive: input.isActive,
  };
}

/** Скидка промокода на сумму блюд (до ограничения — ограничивает computeOrderTotals). */
export function promoEffect(promo: PromoCodeDefinition, subtotal: Money): PromoEffect {
  switch (promo.kind) {
    case PromoKind.Percent:
      return { discount: subtotal.percentage(promo.percentBp ?? 0).min(subtotal), freeDelivery: false };
    case PromoKind.Fixed:
      return { discount: (promo.fixedAmount ?? Money.zero()).min(subtotal), freeDelivery: false };
    case PromoKind.FreeDelivery:
      return { discount: Money.zero(), freeDelivery: true };
  }
}

/** Применим ли промокод к заказу. Порядок проверок — от «промокод вообще действует» к лимитам. */
export function evaluatePromo(promo: PromoCodeState, ctx: PromoContext): PromoEvaluation {
  if (!promo.isActive) return { ok: false, reason: PromoRejection.Inactive };
  if (promo.validFrom && ctx.now.getTime() < promo.validFrom.getTime()) {
    return { ok: false, reason: PromoRejection.NotStarted, details: { validFrom: promo.validFrom.toISOString() } };
  }
  if (promo.validTo && ctx.now.getTime() >= promo.validTo.getTime()) {
    return { ok: false, reason: PromoRejection.Expired, details: { validTo: promo.validTo.toISOString() } };
  }
  if (promo.branchId && promo.branchId !== ctx.branchId) return { ok: false, reason: PromoRejection.WrongBranch };
  if (promo.kind === PromoKind.FreeDelivery && ctx.type !== 'delivery') {
    return { ok: false, reason: PromoRejection.NotApplicable, details: { kind: promo.kind, type: ctx.type } };
  }
  if (promo.minSubtotal && ctx.subtotal.lessThan(promo.minSubtotal)) {
    return { ok: false, reason: PromoRejection.MinSubtotal, details: { minSubtotal: promo.minSubtotal.toJSON() } };
  }
  if (promo.totalLimit !== null && ctx.usage.total >= promo.totalLimit) {
    return { ok: false, reason: PromoRejection.TotalLimitReached };
  }
  if (promo.perPhoneLimit !== null && ctx.usage.byPhone !== null && ctx.usage.byPhone >= promo.perPhoneLimit) {
    return { ok: false, reason: PromoRejection.PhoneLimitReached };
  }
  return { ok: true, effect: promoEffect(promo, ctx.subtotal) };
}

/** Ошибка оформления заказа с неприменимым промокодом. */
export function promoRejectionError(code: string, evaluation: Extract<PromoEvaluation, { ok: false }>): ValidationError {
  return new ValidationError(`promo.${evaluation.reason}`, `Promo code ${code} cannot be applied: ${evaluation.reason}`, {
    code,
    ...(evaluation.details ?? {}),
  });
}
