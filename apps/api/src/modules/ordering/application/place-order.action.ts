import { Injectable } from '@nestjs/common';
import { AuditLog } from '../../../shared/infrastructure/audit/audit-log';
import { Database } from '../../../shared/infrastructure/database/database';
import { DocumentNumbering } from '../../../shared/infrastructure/database/numbering';
import { EventBus } from '../../../shared/infrastructure/events/event-bus';
import { Actor } from '../../../shared/kernel/actor';
import { Clock } from '../../../shared/kernel/clock';
import { ConflictError, ValidationError } from '../../../shared/kernel/errors';
import { assertGeoPoint, GeoPoint } from '../../../shared/kernel/geo';
import { newId } from '../../../shared/kernel/ids';
import { Permission } from '../../../shared/kernel/permissions';
import { normalizePhone } from '../../../shared/kernel/phone';
import { randomToken } from '../../../shared/kernel/random';
import { addMinutes, toLocalDate } from '../../../shared/kernel/time';
import { Locale, translate } from '../../../shared/kernel/translatable';
import { PricedLine, PricedLineRequest } from '../../catalog/public';
import { CustomerDirectory, PhoneVerification } from '../../customers/public';
import { BranchDirectory, BranchInfo } from '../../identity/public';
import { AdminFeed, Notifier } from '../../notifications/public';
import { CreatePaymentCommand, PaymentsService, PaymentView } from '../../payments/public';
import { Order, OrderItemSnapshot, PaymentMethodChoice } from '../domain/order';
import { assertBranchAcceptsOrder, cleanText, orderEtaMinutes } from '../domain/order-rules';
import { formatMoney } from '../domain/order-texts';
import { planCheckoutPayments } from '../domain/payment-plan';
import { promoEffect, promoRejectionError } from '../domain/promo-code';
import { assertAsapAvailable, assertSchedulable } from '../domain/scheduling';
import { zoneTerms } from '../domain/delivery-zone';
import { OrderPaymentsRepository } from '../infrastructure/order-payments.repository';
import { OrderRepository } from '../infrastructure/order.repository';
import { PromoCodeRepository } from '../infrastructure/promo-code.repository';
import { OrderChannel, OrderingEvents, OrderType } from '../public';
import { branchOrderingSettings, scheduleRulesFor } from './order-branch';
import { OrderCertificateCheck } from './order-certificate';
import { orderPlacedPayload } from './order-events';
import { OrderLinks } from './order-links';
import { OrderPricing } from './order-pricing';
import { OrderTransitionRecorder } from './order-transition-recorder';

export interface CheckoutDeliveryInput {
  point: GeoPoint;
  addressText: string;
  apartment?: string | null;
  entrance?: string | null;
  floor?: string | null;
  intercom?: string | null;
  courierComment?: string | null;
}

export interface PlaceOrderInput {
  branchId: string;
  type: OrderType;
  items: PricedLineRequest[];
  /** Только для доставки: точка (витрина геокодирует адрес в браузере) и адрес текстом. */
  delivery: CheckoutDeliveryInput | null;
  contactless: boolean;
  /** null — «как можно скорее». */
  scheduledFor: Date | null;
  customer: { name?: string | null; phone: string; email?: string | null };
  comment?: string | null;
  promoCode?: string | null;
  certificateCode?: string | null;
  paymentMethod: PaymentMethodChoice;
  phoneVerificationToken?: string | null;
  consent: { personalData: boolean; marketing?: boolean | null };
  locale: Locale;
  analyticsSessionId?: string | null;
  idempotencyKey: string;
}

export interface PlaceOrderContext {
  channel: OrderChannel;
  actor: Actor;
  ip: string | null;
}

export interface PlacedOrder {
  order: Order;
  /** Платёж остатка (онлайн — ссылка появится асинхронно; при получении — pending). */
  payment: PaymentView | null;
  /** Повтор запроса с тем же ключом идемпотентности — возвращён уже созданный заказ. */
  replayed: boolean;
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_:.-]{8,128}$/;

function snapshotItems(priced: PricedLine[]): OrderItemSnapshot[] {
  return priced.map((p, position) => ({
    id: newId(),
    position,
    dishId: p.dishId,
    dishSlug: p.dishSlug,
    categoryId: p.categoryId,
    sku: p.sku,
    name: p.dishName,
    photoUrl: p.photoUrl,
    weightGrams: p.weightGrams,
    quantity: p.quantity,
    basePrice: p.basePrice,
    unitPrice: p.unitPrice,
    lineTotal: p.lineTotal,
    modifiers: p.modifiers.map((m) => ({
      groupId: m.groupId,
      groupName: m.groupName,
      optionId: m.optionId,
      optionName: m.optionName,
      price: m.price,
    })),
  }));
}

/**
 * Оформление заказа (витрина и телефонный заказ оператора), docs/decisions.md:
 * заказ создаётся в draft и в той же транзакции проверяется и переводится в awaiting_payment; суммы —
 * только серверный расчёт (MenuPricing, зона, промокод). Платежи: сначала часть сертификатом, остаток —
 * онлайн (подтверждение только по факту оплаты) или при получении (заказ сразу paid — «оплата обеспечена»),
 * нулевой остаток — paid. Промокод резервируется. Идемпотентно по idempotencyKey.
 * Уведомления и внешние вызовы — только записями/задачами: недоступность мессенджера не блокирует приём.
 */
@Injectable()
export class PlaceOrder {
  constructor(
    private readonly branches: BranchDirectory,
    private readonly orders: OrderRepository,
    private readonly orderPayments: OrderPaymentsRepository,
    private readonly promos: PromoCodeRepository,
    private readonly pricing: OrderPricing,
    private readonly certificates: OrderCertificateCheck,
    private readonly customers: CustomerDirectory,
    private readonly phoneVerification: PhoneVerification,
    private readonly payments: PaymentsService,
    private readonly notifier: Notifier,
    private readonly feed: AdminFeed,
    private readonly recorder: OrderTransitionRecorder,
    private readonly numbering: DocumentNumbering,
    private readonly links: OrderLinks,
    private readonly database: Database,
    private readonly events: EventBus,
    private readonly audit: AuditLog,
    private readonly clock: Clock,
  ) {}

  async execute(input: PlaceOrderInput, ctx: PlaceOrderContext): Promise<PlacedOrder> {
    const key = (input.idempotencyKey ?? '').trim();
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      throw new ValidationError('order.invalid_idempotency_key', 'idempotencyKey: 8-128 latin letters, digits, "_", ":", ".", "-"');
    }
    if (ctx.channel === 'admin') ctx.actor.assertCan(Permission.OrdersManage, input.branchId);
    const existingId = await this.orders.findIdByIdempotencyKey(key);
    if (existingId) return this.replay(existingId, input);

    // Проверки без записи — до транзакции.
    const branch = await this.branches.get(input.branchId);
    assertBranchAcceptsOrder(branchOrderingSettings(branch), input.type, input.paymentMethod);
    if (!input.consent?.personalData) {
      throw new ValidationError('order.consent_required', 'Consent to personal data processing is required');
    }
    const phone = normalizePhone(input.customer.phone);
    const now = this.clock.now();
    const rules = scheduleRulesFor(branch, input.type);
    if (input.scheduledFor) assertSchedulable(rules, now, input.scheduledFor);
    else assertAsapAvailable(rules, now);
    const delivery = this.deliveryInput(input);
    if (
      input.paymentMethod === 'on_receipt' &&
      ctx.channel === 'web' &&
      branch.settings.requirePhoneVerificationForOnReceipt
    ) {
      // Гарантия оплаты при получении — телефон, подтверждённый SMS-кодом (оператор звонит гостю сам).
      await this.phoneVerification.assertVerified(phone, input.phoneVerificationToken ?? null);
    }

    return this.database.transaction(async () => {
      await this.database.advisoryLock('ordering.checkout', key);
      const raced = await this.orders.findIdByIdempotencyKey(key);
      if (raced) return this.replay(raced, input);
      return this.place(input, ctx, { key, branch, phone, now, delivery, leadMinutes: rules.leadMinutes });
    });
  }

  private deliveryInput(input: PlaceOrderInput): (CheckoutDeliveryInput & { point: GeoPoint; addressText: string }) | null {
    if (input.type !== 'delivery') return null;
    const addressText = cleanText(input.delivery?.addressText, 500);
    if (!input.delivery || !addressText) {
      throw new ValidationError('order.address_required', 'Delivery address and map point are required');
    }
    return { ...input.delivery, point: assertGeoPoint(input.delivery.point), addressText };
  }

  private async place(
    input: PlaceOrderInput,
    ctx: PlaceOrderContext,
    prepared: {
      key: string;
      branch: BranchInfo;
      phone: string;
      now: Date;
      delivery: (CheckoutDeliveryInput & { point: GeoPoint; addressText: string }) | null;
      leadMinutes: number;
    },
  ): Promise<PlacedOrder> {
    const { branch, phone, now, delivery } = prepared;
    const pricing = await this.pricing.price({
      branchId: branch.id,
      type: input.type,
      lines: input.items,
      point: delivery?.point ?? null,
      promoCode: input.promoCode ?? null,
      phone,
      now,
      strict: true,
      lockPromo: true,
    });
    if (input.type === 'delivery' && !pricing.zone) {
      throw new ValidationError('order.address_not_deliverable', 'The address is outside the delivery zones of the branch');
    }
    let promo: { id: string; code: string; kind: 'percent' | 'fixed' | 'free_delivery'; effect: ReturnType<typeof promoEffect> } | null = null;
    if (pricing.promo) {
      const { evaluation } = pricing.promo;
      if (!evaluation.ok || !pricing.promo.promo) {
        throw promoRejectionError(pricing.promo.code, evaluation.ok ? { ok: false, reason: 'not_found' } : evaluation);
      }
      promo = { id: pricing.promo.promo.id, code: pricing.promo.promo.code, kind: pricing.promo.promo.kind, effect: evaluation.effect };
    }
    const certificateCode = input.certificateCode?.trim() || null;
    const certificate = certificateCode ? await this.certificates.require(certificateCode) : null;

    // Гость и согласие на обработку ПД (дата и версия текста).
    const name = cleanText(input.customer.name, 100);
    const email = cleanText(input.customer.email, 200);
    const { customerId } = await this.customers.identify({ phone, name, email, locale: input.locale });
    const source = ctx.channel === 'web' ? 'web' : 'phone';
    await this.customers.recordConsent({
      customerId,
      kind: 'personal_data',
      granted: true,
      textVersion: await this.customers.currentConsentVersion('personal_data'),
      source,
      ip: ctx.ip,
    });
    if (typeof input.consent.marketing === 'boolean') {
      await this.customers.recordConsent({
        customerId,
        kind: 'marketing',
        granted: input.consent.marketing,
        textVersion: await this.customers.currentConsentVersion('marketing'),
        source,
        ip: ctx.ip,
      });
    }

    const year = Number(toLocalDate(now, branch.timezone).slice(0, 4));
    const number = DocumentNumbering.format(branch.code, year, await this.numbering.next('order', branch.id, year));
    const zone = pricing.zone ? zoneTerms(pricing.zone) : null;
    const order = Order.create(
      {
        id: newId(),
        number,
        publicToken: randomToken(),
        branchId: branch.id,
        type: input.type,
        channel: ctx.channel,
        customer: { customerId, name, phone, email },
        delivery: delivery
          ? {
              point: delivery.point,
              addressText: delivery.addressText,
              apartment: cleanText(delivery.apartment, 50),
              entrance: cleanText(delivery.entrance, 50),
              floor: cleanText(delivery.floor, 50),
              intercom: cleanText(delivery.intercom, 50),
              courierComment: cleanText(delivery.courierComment, 500),
              zoneId: zone?.zoneId ?? null,
            }
          : null,
        contactless: input.type === 'delivery' && input.contactless,
        scheduledFor: input.scheduledFor,
        etaMinutes: orderEtaMinutes(input.type, prepared.leadMinutes, zone?.etaMinutes ?? null),
        comment: cleanText(input.comment),
        promo: promo ? { promoCodeId: promo.id, code: promo.code, kind: promo.kind } : null,
        certificateMaskedCode: certificate?.maskedCode ?? null,
        paymentMethod: input.paymentMethod,
        items: snapshotItems(pricing.priced),
        locale: input.locale,
        analyticsSessionId: cleanText(input.analyticsSessionId, 100),
        idempotencyKey: prepared.key,
        createdBy: ctx.channel === 'admin' ? ctx.actor.userId : null,
        zone,
        promoEffect: promo?.effect ?? null,
      },
      now,
    );
    order.submit(now);
    await this.orders.insert(order);
    const s = order.snapshot();
    if (promo) {
      // Экономия гостя: скидка на блюда или стоимость доставки, если её обнулил промокод.
      const saved =
        pricing.breakdown.freeDeliveryReason === 'promo' ? s.totals.discount.add(pricing.breakdown.baseDeliveryFee) : s.totals.discount;
      await this.promos.reserve({ promoCodeId: promo.id, orderId: order.id, phone, discount: saved });
    }
    await this.recorder.record(order, { actor: ctx.actor });
    await this.events.publish(OrderingEvents.OrderPlaced, orderPlacedPayload(order, now), { aggregateId: order.id, branchId: order.branchId });

    const before = order.auditView();
    const payment = await this.createPayments(order, certificate ? { code: certificateCode!, balance: certificate.balance } : null, branch, now);
    await this.orders.save(order);
    await this.recorder.record(order, { actor: ctx.actor, before });

    await this.audit.record({
      action: 'order.placed',
      entityType: 'order',
      entityId: order.id,
      branchId: order.branchId,
      after: { ...order.auditView(), items: s.items.length, certificate: s.certificateMaskedCode },
      meta: { channel: ctx.channel, idempotencyKey: prepared.key },
      actor: ctx.actor,
    });
    await this.notifier.notifyGuest({
      recipient: { phone, email, name },
      template: 'order.created',
      params: {
        number,
        total: formatMoney(s.totals.total),
        trackingUrl: this.links.tracking(s.publicToken, s.locale),
        branchName: translate(branch.name, s.locale),
      },
      locale: s.locale,
      dedupeKey: `order:${order.id}:created`,
      related: { type: 'order', id: order.id },
    });
    if (order.status === 'awaiting_payment') {
      await this.feed.push({
        branchId: order.branchId,
        stream: 'orders',
        kind: 'updated',
        entityId: order.id,
        title: `Заказ ${number} ожидает оплаты · ${formatMoney(s.totals.total)}`,
        sound: false,
      });
    }
    return { order, payment, replayed: false };
  }

  /** Сертификат, затем остаток онлайн или при получении. Возвращает платёж остатка. */
  private async createPayments(
    order: Order,
    certificate: { code: string; balance: PaymentView['amount'] } | null,
    branch: BranchInfo,
    now: Date,
  ): Promise<PaymentView | null> {
    const s = order.snapshot();
    const plan = planCheckoutPayments(s.totals.total, certificate?.balance ?? null);
    const base: Omit<CreatePaymentCommand, 'method' | 'amount' | 'idempotencyKey' | 'returnUrl'> = {
      purpose: 'order',
      referenceId: order.id,
      branchId: order.branchId,
      description: `Заказ ${s.number}`,
      customer: { phone: s.customer.phone, name: s.customer.name, email: s.customer.email },
    };
    if (certificate && plan.certificate.isPositive()) {
      const p = await this.payments.createPayment({
        ...base,
        method: 'gift_certificate',
        amount: plan.certificate,
        certificateCode: certificate.code,
        returnUrl: null,
        idempotencyKey: `order:${order.id}:certificate`,
      });
      await this.orderPayments.link({ paymentId: p.id, orderId: order.id, kind: 'certificate', attempt: 1, amount: plan.certificate });
    }
    if (!plan.remainder.isPositive()) {
      order.markPaid(now);
      return null;
    }
    if (s.paymentMethod === 'online') {
      const p = await this.payments.createPayment({
        ...base,
        method: 'online',
        amount: plan.remainder,
        returnUrl: this.links.tracking(s.publicToken, s.locale),
        idempotencyKey: `order:${order.id}:online:1`,
        expiresAt: addMinutes(s.timestamps.placedAt, branch.settings.awaitingPaymentTimeoutMinutes),
      });
      await this.orderPayments.link({ paymentId: p.id, orderId: order.id, kind: 'online', attempt: 1, amount: plan.remainder });
      order.setCurrentPayment(p.id);
      return p;
    }
    const p = await this.payments.createPayment({
      ...base,
      method: 'on_receipt',
      amount: plan.remainder,
      returnUrl: null,
      idempotencyKey: `order:${order.id}:on_receipt`,
    });
    await this.orderPayments.link({ paymentId: p.id, orderId: order.id, kind: 'on_receipt', attempt: 1, amount: plan.remainder });
    order.setCurrentPayment(p.id);
    // Оплата при получении: у провайдера подтверждать нечего — «оплата обеспечена» (docs/decisions.md).
    order.markPaid(now);
    return p;
  }

  private async replay(orderId: string, input: PlaceOrderInput): Promise<PlacedOrder> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new ConflictError('order.idempotency_conflict', 'Order with this idempotency key is being created');
    if (order.branchId !== input.branchId || order.type !== input.type) {
      throw new ConflictError('order.idempotency_key_reused', 'Idempotency key was used for another order');
    }
    const paymentId = order.snapshot().currentPaymentId;
    return { order, payment: paymentId ? await this.payments.getPayment(paymentId) : null, replayed: true };
  }
}
