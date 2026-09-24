import { Injectable } from '@nestjs/common';
import { Selectable, sql } from 'kysely';
import { Database } from '../../../shared/infrastructure/database/database';
import { Actor } from '../../../shared/kernel/actor';
import { newId } from '../../../shared/kernel/ids';
import { Currency, Money } from '../../../shared/kernel/money';
import { offsetOf, Page, pageOf, PageRequest } from '../../../shared/kernel/pagination';
import { Locale, Translatable } from '../../../shared/kernel/translatable';
import { CancelReasonCode } from '../domain/order-status';
import { Order, OrderItemModifier, OrderItemSnapshot, OrderState, OrderTransition, PaymentMethodChoice } from '../domain/order';
import { PromoKind } from '../domain/promo-code';
import { OrderChannel, OrderStatus, OrderType } from '../public';
import { OrderItemsTable, OrderingTables, OrdersTable } from './ordering.tables';

function money(amount: number, currency: string): Money {
  return Money.of(amount, currency as Currency);
}

interface ModifierJson {
  groupId: string;
  groupName: Translatable;
  optionId: string;
  optionName: Translatable;
  price: { amount: number; currency: Currency };
}

function mapItem(row: Selectable<OrderItemsTable>): OrderItemSnapshot {
  return {
    id: row.id,
    position: row.position,
    dishId: row.dish_id,
    dishSlug: row.dish_slug,
    categoryId: row.category_id,
    sku: row.sku,
    name: row.name as Translatable,
    photoUrl: row.photo_url,
    weightGrams: row.weight_grams,
    quantity: row.quantity,
    basePrice: money(row.base_price_amount, row.base_price_currency),
    unitPrice: money(row.unit_price_amount, row.unit_price_currency),
    lineTotal: money(row.line_total_amount, row.line_total_currency),
    modifiers: ((row.modifiers as ModifierJson[]) ?? []).map(
      (m): OrderItemModifier => ({ ...m, price: Money.fromJson(m.price) }),
    ),
  };
}

export function mapOrderState(row: Selectable<OrdersTable>, items: OrderItemSnapshot[]): OrderState {
  return {
    id: row.id,
    number: row.number,
    publicToken: row.public_token,
    branchId: row.branch_id,
    type: row.type as OrderType,
    channel: row.channel as OrderChannel,
    status: row.status as OrderStatus,
    customer: { customerId: row.customer_id, name: row.customer_name, phone: row.customer_phone, email: row.customer_email },
    delivery:
      row.type === 'delivery' && row.delivery_lat !== null && row.delivery_lng !== null
        ? {
            point: { lat: row.delivery_lat, lng: row.delivery_lng },
            addressText: row.delivery_address ?? '',
            apartment: row.delivery_apartment,
            entrance: row.delivery_entrance,
            floor: row.delivery_floor,
            intercom: row.delivery_intercom,
            courierComment: row.delivery_courier_comment,
            zoneId: row.delivery_zone_id,
          }
        : null,
    contactless: row.contactless,
    scheduledFor: row.scheduled_for,
    etaMinutes: row.eta_minutes,
    promisedAt: row.promised_at,
    comment: row.comment,
    promo: row.promo_code_id && row.promo_code ? { promoCodeId: row.promo_code_id, code: row.promo_code, kind: row.promo_kind as PromoKind } : null,
    certificateMaskedCode: row.certificate_masked_code,
    paymentMethod: row.payment_method as PaymentMethodChoice,
    currentPaymentId: row.current_payment_id,
    items,
    totals: {
      subtotal: money(row.subtotal_amount, row.subtotal_currency),
      discount: money(row.discount_amount, row.discount_currency),
      deliveryFee: money(row.delivery_fee_amount, row.delivery_fee_currency),
      total: money(row.total_amount, row.total_currency),
    },
    locale: row.locale as Locale,
    analyticsSessionId: row.analytics_session_id,
    idempotencyKey: row.idempotency_key,
    createdBy: row.created_by,
    cancellation: row.cancel_reason_code ? { reasonCode: row.cancel_reason_code as CancelReasonCode, reason: row.cancel_reason } : null,
    wasPaid: row.was_paid,
    timestamps: {
      placedAt: row.placed_at,
      paidAt: row.paid_at,
      acceptedAt: row.accepted_at,
      cookingAt: row.cooking_at,
      readyAt: row.ready_at,
      deliveringAt: row.delivering_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      refundedAt: row.refunded_at,
    },
  };
}

function mutableColumns(s: OrderState) {
  return {
    status: s.status,
    customer_id: s.customer.customerId,
    customer_name: s.customer.name,
    customer_phone: s.customer.phone,
    customer_email: s.customer.email,
    delivery_address: s.delivery?.addressText ?? null,
    delivery_apartment: s.delivery?.apartment ?? null,
    delivery_entrance: s.delivery?.entrance ?? null,
    delivery_floor: s.delivery?.floor ?? null,
    delivery_intercom: s.delivery?.intercom ?? null,
    delivery_courier_comment: s.delivery?.courierComment ?? null,
    promised_at: s.promisedAt,
    comment: s.comment,
    current_payment_id: s.currentPaymentId,
    cancel_reason_code: s.cancellation?.reasonCode ?? null,
    cancel_reason: s.cancellation?.reason ?? null,
    was_paid: s.wasPaid,
    paid_at: s.timestamps.paidAt,
    accepted_at: s.timestamps.acceptedAt,
    cooking_at: s.timestamps.cookingAt,
    ready_at: s.timestamps.readyAt,
    delivering_at: s.timestamps.deliveringAt,
    completed_at: s.timestamps.completedAt,
    cancelled_at: s.timestamps.cancelledAt,
    refunded_at: s.timestamps.refundedAt,
  };
}

export interface StatusHistoryEntry {
  from: OrderStatus | null;
  to: OrderStatus;
  at: Date;
  actorKind: string;
  actorName: string;
  actorUserId: string | null;
  reasonCode: string | null;
  reason: string | null;
}

export interface OrderListFilter {
  branches: 'all' | string[];
  statuses?: OrderStatus[];
  type?: OrderType;
  from?: Date;
  to?: Date;
  q?: string;
}

/** Хранилище заказов: заказ, позиции-снимки, история статусов. */
@Injectable()
export class OrderRepository {
  constructor(private readonly database: Database) {}

  private db() {
    return this.database.db<OrderingTables>();
  }

  async insert(order: Order): Promise<void> {
    const s = order.snapshot();
    await this.db()
      .insertInto('ordering.orders')
      .values({
        id: s.id,
        number: s.number,
        public_token: s.publicToken,
        branch_id: s.branchId,
        type: s.type,
        channel: s.channel,
        delivery_lat: s.delivery?.point.lat ?? null,
        delivery_lng: s.delivery?.point.lng ?? null,
        delivery_zone_id: s.delivery?.zoneId ?? null,
        contactless: s.contactless,
        scheduled_for: s.scheduledFor,
        eta_minutes: s.etaMinutes,
        promo_code_id: s.promo?.promoCodeId ?? null,
        promo_code: s.promo?.code ?? null,
        promo_kind: s.promo?.kind ?? null,
        certificate_masked_code: s.certificateMaskedCode,
        payment_method: s.paymentMethod,
        subtotal_amount: s.totals.subtotal.amount,
        subtotal_currency: s.totals.subtotal.currency,
        discount_amount: s.totals.discount.amount,
        discount_currency: s.totals.discount.currency,
        delivery_fee_amount: s.totals.deliveryFee.amount,
        delivery_fee_currency: s.totals.deliveryFee.currency,
        total_amount: s.totals.total.amount,
        total_currency: s.totals.total.currency,
        locale: s.locale,
        analytics_session_id: s.analyticsSessionId,
        idempotency_key: s.idempotencyKey,
        created_by: s.createdBy,
        placed_at: s.timestamps.placedAt,
        deleted_at: null,
        ...mutableColumns(s),
      })
      .execute();
    await this.db()
      .insertInto('ordering.order_items')
      .values(
        s.items.map((i) => ({
          id: i.id,
          order_id: s.id,
          position: i.position,
          dish_id: i.dishId,
          dish_slug: i.dishSlug,
          category_id: i.categoryId,
          sku: i.sku,
          name: JSON.stringify(i.name),
          photo_url: i.photoUrl,
          weight_grams: i.weightGrams,
          quantity: i.quantity,
          base_price_amount: i.basePrice.amount,
          base_price_currency: i.basePrice.currency,
          unit_price_amount: i.unitPrice.amount,
          unit_price_currency: i.unitPrice.currency,
          line_total_amount: i.lineTotal.amount,
          line_total_currency: i.lineTotal.currency,
          modifiers: JSON.stringify(i.modifiers.map((m) => ({ ...m, price: m.price.toJSON() }))),
        })),
      )
      .execute();
  }

  async save(order: Order): Promise<void> {
    await this.db().updateTable('ordering.orders').set(mutableColumns(order.snapshot())).where('id', '=', order.id).execute();
  }

  private async load(row: Selectable<OrdersTable> | undefined): Promise<Order | null> {
    if (!row) return null;
    const items = await this.db().selectFrom('ordering.order_items').selectAll().where('order_id', '=', row.id).orderBy('position').execute();
    return Order.restore(mapOrderState(row, items.map(mapItem)));
  }

  async findById(id: string, options: { forUpdate?: boolean } = {}): Promise<Order | null> {
    let q = this.db().selectFrom('ordering.orders').selectAll().where('id', '=', id).where('deleted_at', 'is', null);
    if (options.forUpdate) q = q.forUpdate();
    return this.load(await q.executeTakeFirst());
  }

  async findByPublicToken(token: string): Promise<Order | null> {
    const row = await this.db()
      .selectFrom('ordering.orders')
      .selectAll()
      .where('public_token', '=', token)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    return this.load(row);
  }

  async findIdByIdempotencyKey(key: string): Promise<string | null> {
    const row = await this.db().selectFrom('ordering.orders').select('id').where('idempotency_key', '=', key).executeTakeFirst();
    return row?.id ?? null;
  }

  async appendHistory(orderId: string, transitions: readonly OrderTransition[], actor: Actor): Promise<void> {
    if (transitions.length === 0) return;
    await this.db()
      .insertInto('ordering.order_status_history')
      .values(
        transitions.map((t) => ({
          id: newId(),
          order_id: orderId,
          from_status: t.from,
          to_status: t.to,
          occurred_at: t.at,
          actor_kind: actor.kind,
          actor_user_id: actor.userId,
          actor_name: actor.name,
          reason_code: t.reasonCode,
          reason: t.reason,
        })),
      )
      .execute();
  }

  async history(orderId: string): Promise<StatusHistoryEntry[]> {
    const rows = await this.db()
      .selectFrom('ordering.order_status_history')
      .selectAll()
      .where('order_id', '=', orderId)
      .orderBy('occurred_at')
      .orderBy('id')
      .execute();
    return rows.map((r) => ({
      from: r.from_status as OrderStatus | null,
      to: r.to_status as OrderStatus,
      at: r.occurred_at,
      actorKind: r.actor_kind,
      actorName: r.actor_name,
      actorUserId: r.actor_user_id,
      reasonCode: r.reason_code,
      reason: r.reason,
    }));
  }

  /** Список для админки (без позиций). */
  async list(filter: OrderListFilter, page: PageRequest): Promise<Page<OrderState>> {
    let q = this.db().selectFrom('ordering.orders').where('deleted_at', 'is', null);
    if (filter.branches !== 'all') {
      if (filter.branches.length === 0) return pageOf([], 0, page);
      q = q.where('branch_id', 'in', filter.branches);
    }
    if (filter.statuses?.length) q = q.where('status', 'in', filter.statuses);
    if (filter.type) q = q.where('type', '=', filter.type);
    if (filter.from) q = q.where('placed_at', '>=', filter.from);
    if (filter.to) q = q.where('placed_at', '<', filter.to);
    const text = filter.q?.trim();
    if (text) {
      const digits = text.replace(/\D/g, '');
      q = q.where((eb) =>
        eb.or([
          eb('number', 'ilike', `%${text.replace(/[%_\\]/g, (c) => `\\${c}`)}%`),
          ...(digits.length >= 4 ? [eb('customer_phone', 'like', `%${digits.slice(-10)}%`)] : []),
        ]),
      );
    }
    const total = await q.select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    const rows = await q.selectAll().orderBy('placed_at', 'desc').orderBy('id', 'desc').limit(page.perPage).offset(offsetOf(page)).execute();
    return pageOf(
      rows.map((r) => mapOrderState(r, [])),
      Number(total?.n ?? 0),
      page,
    );
  }

  /** Активные заказы для экрана оператора (без позиций). */
  async active(branches: 'all' | string[], statuses: readonly OrderStatus[]): Promise<OrderState[]> {
    let q = this.db().selectFrom('ordering.orders').selectAll().where('deleted_at', 'is', null).where('status', 'in', [...statuses]);
    if (branches !== 'all') {
      if (branches.length === 0) return [];
      q = q.where('branch_id', 'in', branches);
    }
    const rows = await q.orderBy(sql`coalesce(scheduled_for, promised_at)`).orderBy('placed_at').limit(500).execute();
    return rows.map((r) => mapOrderState(r, []));
  }

  /** Неоплаченные заказы филиала, оформленные раньше момента (автоотмена). */
  async awaitingPaymentPlacedBefore(branchId: string, before: Date, limit = 200): Promise<string[]> {
    const rows = await this.db()
      .selectFrom('ordering.orders')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('status', '=', 'awaiting_payment')
      .where('placed_at', '<', before)
      .where('deleted_at', 'is', null)
      .orderBy('placed_at')
      .limit(limit)
      .execute();
    return rows.map((r) => r.id);
  }

  async idsByCustomer(customerId: string): Promise<string[]> {
    const rows = await this.db().selectFrom('ordering.orders').select('id').where('customer_id', '=', customerId).execute();
    return rows.map((r) => r.id);
  }
}
