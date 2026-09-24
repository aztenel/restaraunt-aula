import { InvalidStateTransitionError, ValidationError } from '../../../shared/kernel/errors';
import { GeoPoint } from '../../../shared/kernel/geo';
import { Money } from '../../../shared/kernel/money';
import { Locale, Translatable } from '../../../shared/kernel/translatable';
import { OrderChannel, OrderStatus, OrderType } from '../public';
import {
  CANCELLABLE_STATUSES,
  CancelReasonCode,
  canTransitionOrder,
  isCancelReasonCode,
  ORDER_FSM,
  PARTIAL_REFUND_STATUSES,
  STAFF_TRANSITION_TARGETS,
  StaffTransitionTarget,
} from './order-status';
import { PromoKind } from './promo-code';
import { promisedTime } from './scheduling';
import { computeOrderTotals, OrderTotals, PromoEffect, ZoneTerms } from './totals';

/** Опция модификатора в снимке позиции. */
export interface OrderItemModifier {
  groupId: string;
  groupName: Translatable;
  optionId: string;
  optionName: Translatable;
  price: Money;
}

/** Позиция заказа — снимок на момент заказа: изменение меню не меняет прошлые заказы. */
export interface OrderItemSnapshot {
  id: string;
  position: number;
  dishId: string;
  dishSlug: string;
  categoryId: string | null;
  sku: string | null;
  name: Translatable;
  photoUrl: string | null;
  weightGrams: number | null;
  quantity: number;
  basePrice: Money;
  unitPrice: Money;
  lineTotal: Money;
  modifiers: OrderItemModifier[];
}

export interface DeliveryDetails {
  point: GeoPoint;
  addressText: string;
  apartment: string | null;
  entrance: string | null;
  floor: string | null;
  intercom: string | null;
  courierComment: string | null;
  zoneId: string | null;
}

export interface OrderCustomer {
  customerId: string | null;
  name: string | null;
  phone: string;
  email: string | null;
}

export interface OrderPromo {
  promoCodeId: string;
  code: string;
  kind: PromoKind;
}

export type PaymentMethodChoice = 'online' | 'on_receipt';

export interface OrderTimestamps {
  placedAt: Date;
  paidAt: Date | null;
  acceptedAt: Date | null;
  cookingAt: Date | null;
  readyAt: Date | null;
  deliveringAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  refundedAt: Date | null;
}

export interface OrderCancellation {
  reasonCode: CancelReasonCode;
  reason: string | null;
}

export interface OrderState {
  id: string;
  number: string;
  publicToken: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  customer: OrderCustomer;
  delivery: DeliveryDetails | null;
  contactless: boolean;
  scheduledFor: Date | null;
  /** Ориентировочная длительность «от оформления/принятия до выдачи», минут. */
  etaMinutes: number;
  /** Обещанное гостю время выдачи/доставки. */
  promisedAt: Date;
  comment: string | null;
  promo: OrderPromo | null;
  certificateMaskedCode: string | null;
  paymentMethod: PaymentMethodChoice;
  /** Текущий платёж остатка (онлайн / при получении), по нему витрина показывает ссылку на оплату. */
  currentPaymentId: string | null;
  items: OrderItemSnapshot[];
  totals: OrderTotals;
  locale: Locale;
  analyticsSessionId: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  cancellation: OrderCancellation | null;
  /** Заказ был оплачен (дошёл до paid) — для отчёта по отменам и расчёта возвратов. */
  wasPaid: boolean;
  timestamps: OrderTimestamps;
}

export interface NewOrderInput {
  id: string;
  number: string;
  publicToken: string;
  branchId: string;
  type: OrderType;
  channel: OrderChannel;
  customer: OrderCustomer;
  delivery: DeliveryDetails | null;
  contactless: boolean;
  scheduledFor: Date | null;
  etaMinutes: number;
  comment: string | null;
  promo: OrderPromo | null;
  certificateMaskedCode: string | null;
  paymentMethod: PaymentMethodChoice;
  items: OrderItemSnapshot[];
  locale: Locale;
  analyticsSessionId: string | null;
  idempotencyKey: string;
  createdBy: string | null;
  /** Условия зоны доставки (для доставки обязательны). */
  zone: ZoneTerms | null;
  /** Эффект промокода (уже проверенного правилами). */
  promoEffect: PromoEffect | null;
}

export interface OrderTransition {
  from: OrderStatus;
  to: OrderStatus;
  at: Date;
  reasonCode: string | null;
  reason: string | null;
}

export const MAX_ORDER_LINES = 50;

/**
 * Агрегат «Заказ». Статус меняется только методами переходов (правило 5 ТЗ): недопустимый переход —
 * InvalidStateTransitionError. Суммы считаются при создании из снимков позиций, условий зоны и промокода.
 */
export class Order {
  private pending: OrderTransition[] = [];

  private constructor(private readonly state: OrderState) {}

  static create(input: NewOrderInput, now: Date): Order {
    if (input.items.length === 0) throw new ValidationError('order.empty', 'Order must contain at least one item');
    if (input.items.length > MAX_ORDER_LINES) {
      throw new ValidationError('order.too_many_lines', `Order may contain at most ${MAX_ORDER_LINES} lines`);
    }
    for (const item of input.items) {
      if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new ValidationError('order.invalid_quantity', 'Quantity must be 1..99', { dishId: item.dishId });
      }
      if (!item.unitPrice.multiply(item.quantity).equals(item.lineTotal)) {
        throw new ValidationError('order.line_total_mismatch', 'Line total must equal unit price × quantity', { dishId: item.dishId });
      }
    }
    if (input.type === 'delivery' && (!input.delivery || !input.zone)) {
      throw new ValidationError('order.delivery_required', 'Delivery address inside a delivery zone is required');
    }
    if (input.type === 'pickup' && input.delivery) {
      throw new ValidationError('order.delivery_not_allowed', 'Pickup order must not have a delivery address');
    }
    const breakdown = computeOrderTotals({
      lineTotals: input.items.map((i) => i.lineTotal),
      type: input.type,
      zone: input.zone,
      promo: input.promoEffect,
    });
    if (breakdown.minOrderShortfall.isPositive()) {
      throw new ValidationError('order.min_order_not_reached', 'Order subtotal is below the minimal order amount of the zone', {
        minOrderAmount: input.zone?.minOrderAmount.toJSON(),
        subtotal: breakdown.subtotal.toJSON(),
        shortfall: breakdown.minOrderShortfall.toJSON(),
      });
    }
    const { subtotal, discount, deliveryFee, total } = breakdown;
    return new Order({
      id: input.id,
      number: input.number,
      publicToken: input.publicToken,
      branchId: input.branchId,
      type: input.type,
      channel: input.channel,
      status: 'draft',
      customer: input.customer,
      delivery: input.delivery ? { ...input.delivery, zoneId: input.zone?.zoneId ?? input.delivery.zoneId } : null,
      contactless: input.contactless,
      scheduledFor: input.scheduledFor,
      etaMinutes: input.etaMinutes,
      promisedAt: promisedTime({ scheduledFor: input.scheduledFor, from: now, etaMinutes: input.etaMinutes }),
      comment: input.comment,
      promo: input.promo,
      certificateMaskedCode: input.certificateMaskedCode,
      paymentMethod: input.paymentMethod,
      currentPaymentId: null,
      items: input.items,
      totals: { subtotal, discount, deliveryFee, total },
      locale: input.locale,
      analyticsSessionId: input.analyticsSessionId,
      idempotencyKey: input.idempotencyKey,
      createdBy: input.createdBy,
      cancellation: null,
      wasPaid: false,
      timestamps: {
        placedAt: now,
        paidAt: null,
        acceptedAt: null,
        cookingAt: null,
        readyAt: null,
        deliveringAt: null,
        completedAt: null,
        cancelledAt: null,
        refundedAt: null,
      },
    });
  }

  static restore(state: OrderState): Order {
    return new Order(state);
  }

  get id(): string {
    return this.state.id;
  }

  get status(): OrderStatus {
    return this.state.status;
  }

  get branchId(): string {
    return this.state.branchId;
  }

  get type(): OrderType {
    return this.state.type;
  }

  get total(): Money {
    return this.state.totals.total;
  }

  snapshot(): Readonly<OrderState> {
    return this.state;
  }

  /** Переходы, накопленные с момента загрузки (для истории, журнала и событий). */
  pullTransitions(): OrderTransition[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  // ------------------------------------------------------------------ переходы

  /** draft → awaiting_payment: заказ оформлен и ждёт оплаты. */
  submit(now: Date): void {
    this.move('awaiting_payment', now);
  }

  /** awaiting_payment → paid: оплата подтверждена (или обеспечена — оплата при получении). */
  markPaid(now: Date): void {
    this.move('paid', now);
    this.state.wasPaid = true;
  }

  /** paid → accepted: ресторан принял заказ. Для «как можно скорее» обещанное время отсчитывается от принятия. */
  accept(now: Date): void {
    this.move('accepted', now);
    this.state.promisedAt = promisedTime({
      scheduledFor: this.state.scheduledFor,
      from: now,
      etaMinutes: this.state.etaMinutes,
      current: this.state.promisedAt,
    });
  }

  startCooking(now: Date): void {
    this.move('cooking', now);
  }

  markReady(now: Date): void {
    this.move('ready', now);
  }

  /** ready → delivering — только для доставки. */
  startDelivery(now: Date): void {
    this.move('delivering', now);
  }

  /** delivering → completed (доставка) или ready → completed (самовывоз). */
  complete(now: Date): void {
    this.move('completed', now);
  }

  /** Отмена — только из awaiting_payment и accepted (схема ТЗ). */
  cancel(reasonCode: CancelReasonCode, reason: string | null, now: Date): void {
    if (!isCancelReasonCode(reasonCode)) {
      throw new ValidationError('order.invalid_cancel_reason', 'Unknown cancel reason code', { reasonCode });
    }
    this.move('cancelled', now, reasonCode, reason);
    this.state.cancellation = { reasonCode, reason };
  }

  /**
   * Отказ ресторана от оплаченного заказа: paid → accepted → cancelled (два разрешённых перехода,
   * оба попадают в историю и журнал). Прямого paid → cancelled схема ТЗ не допускает.
   */
  reject(reasonCode: CancelReasonCode, reason: string | null, now: Date): void {
    if (this.state.status !== 'paid') throw new InvalidStateTransitionError('order', this.state.status, 'cancelled');
    this.move('accepted', now, reasonCode, reason);
    this.cancel(reasonCode, reason, now);
  }

  /** cancelled → refunded: все запрошенные возвраты прошли. */
  markRefunded(now: Date): void {
    this.move('refunded', now);
  }

  /** Смена статуса сотрудником (экран оператора). */
  applyStaffTransition(to: StaffTransitionTarget, now: Date): void {
    switch (to) {
      case 'accepted':
        return this.accept(now);
      case 'cooking':
        return this.startCooking(now);
      case 'ready':
        return this.markReady(now);
      case 'delivering':
        return this.startDelivery(now);
      case 'completed':
        return this.complete(now);
    }
  }

  // ------------------------------------------------------------------ вычисляемое

  /** Все допустимые переходы из текущего статуса (схема ТЗ + тип заказа). */
  allowedTransitions(): OrderStatus[] {
    return ORDER_FSM.allowedFrom(this.state.status).filter((to) => canTransitionOrder(this.state.type, this.state.status, to));
  }

  /** Переходы, доступные сотруднику: смена статуса и отмена (оплата и возврат — автоматически). */
  staffTransitions(): OrderStatus[] {
    return this.allowedTransitions().filter(
      (to) => (STAFF_TRANSITION_TARGETS as readonly string[]).includes(to) || (to === 'cancelled' && this.canCancel()),
    );
  }

  canCancel(): boolean {
    return CANCELLABLE_STATUSES.includes(this.state.status);
  }

  canReject(): boolean {
    return this.state.status === 'paid';
  }

  canPartialRefund(): boolean {
    return PARTIAL_REFUND_STATUSES.includes(this.state.status);
  }

  isFinal(): boolean {
    return ORDER_FSM.isFinal(this.state.status);
  }

  setCurrentPayment(paymentId: string): void {
    this.state.currentPaymentId = paymentId;
  }

  /** Обезличивание по требованию гостя (закон РК о ПД): контакты и адрес стираются, суммы остаются. */
  anonymize(): void {
    this.state.customer = { customerId: this.state.customer.customerId, name: null, phone: 'anonymized', email: null };
    if (this.state.delivery) {
      this.state.delivery = {
        ...this.state.delivery,
        addressText: 'anonymized',
        apartment: null,
        entrance: null,
        floor: null,
        intercom: null,
        courierComment: null,
      };
    }
    this.state.comment = null;
  }

  /** Снимок для журнала действий (было/стало). */
  auditView(): Record<string, unknown> {
    const s = this.state;
    return {
      status: s.status,
      number: s.number,
      type: s.type,
      channel: s.channel,
      paymentMethod: s.paymentMethod,
      subtotal: s.totals.subtotal.toJSON(),
      discount: s.totals.discount.toJSON(),
      deliveryFee: s.totals.deliveryFee.toJSON(),
      total: s.totals.total.toJSON(),
      promoCode: s.promo?.code ?? null,
      cancellation: s.cancellation,
      promisedAt: s.promisedAt.toISOString(),
    };
  }

  private move(to: OrderStatus, now: Date, reasonCode: string | null = null, reason: string | null = null): void {
    const from = this.state.status;
    if (!canTransitionOrder(this.state.type, from, to)) {
      throw new InvalidStateTransitionError('order', from, to);
    }
    this.state.status = to;
    const ts = this.state.timestamps;
    switch (to) {
      case 'paid':
        ts.paidAt = now;
        break;
      case 'accepted':
        ts.acceptedAt = now;
        break;
      case 'cooking':
        ts.cookingAt = now;
        break;
      case 'ready':
        ts.readyAt = now;
        break;
      case 'delivering':
        ts.deliveringAt = now;
        break;
      case 'completed':
        ts.completedAt = now;
        break;
      case 'cancelled':
        ts.cancelledAt = now;
        break;
      case 'refunded':
        ts.refundedAt = now;
        break;
      default:
        break;
    }
    this.pending.push({ from, to, at: now, reasonCode, reason });
  }
}
