import { Generated } from 'kysely';

/** Таблицы схемы ordering. Модуль видит только их. */
export interface OrdersTable {
  id: string;
  number: string;
  public_token: string;
  branch_id: string;
  type: string;
  channel: string;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivery_address: string | null;
  delivery_apartment: string | null;
  delivery_entrance: string | null;
  delivery_floor: string | null;
  delivery_intercom: string | null;
  delivery_courier_comment: string | null;
  delivery_zone_id: string | null;
  contactless: boolean;
  scheduled_for: Date | null;
  eta_minutes: number;
  promised_at: Date;
  comment: string | null;
  promo_code_id: string | null;
  promo_code: string | null;
  promo_kind: string | null;
  certificate_masked_code: string | null;
  payment_method: string;
  current_payment_id: string | null;
  subtotal_amount: number;
  subtotal_currency: string;
  discount_amount: number;
  discount_currency: string;
  delivery_fee_amount: number;
  delivery_fee_currency: string;
  total_amount: number;
  total_currency: string;
  locale: string;
  analytics_session_id: string | null;
  idempotency_key: string;
  created_by: string | null;
  cancel_reason_code: string | null;
  cancel_reason: string | null;
  was_paid: boolean;
  placed_at: Date;
  paid_at: Date | null;
  accepted_at: Date | null;
  cooking_at: Date | null;
  ready_at: Date | null;
  delivering_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  refunded_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface OrderItemsTable {
  id: string;
  order_id: string;
  position: number;
  dish_id: string;
  dish_slug: string;
  category_id: string | null;
  sku: string | null;
  name: unknown;
  photo_url: string | null;
  weight_grams: number | null;
  quantity: number;
  base_price_amount: number;
  base_price_currency: string;
  unit_price_amount: number;
  unit_price_currency: string;
  line_total_amount: number;
  line_total_currency: string;
  modifiers: unknown;
  created_at: Generated<Date>;
}

export interface OrderStatusHistoryTable {
  id: string;
  order_id: string;
  from_status: string | null;
  to_status: string;
  occurred_at: Date;
  actor_kind: string;
  actor_user_id: string | null;
  actor_name: string;
  reason_code: string | null;
  reason: string | null;
}

export interface OrderPaymentsTable {
  payment_id: string;
  order_id: string;
  kind: string;
  attempt: number;
  amount_amount: number;
  amount_currency: string;
  created_at: Generated<Date>;
}

export interface OrderRefundsTable {
  refund_id: string;
  order_id: string;
  payment_id: string;
  kind: string;
  status: string;
  amount_amount: number;
  amount_currency: string;
  reason: string;
  requested_by: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  completed_at: Date | null;
}

export interface DeliveryZonesTable {
  id: string;
  branch_id: string;
  name: unknown;
  polygon: unknown;
  min_order_amount: number;
  min_order_currency: string;
  delivery_fee_amount: number;
  delivery_fee_currency: string;
  free_delivery_from_amount: number | null;
  free_delivery_from_currency: string;
  eta_minutes: number;
  is_active: boolean;
  sort_order: number;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface PromoCodesTable {
  id: string;
  code: string;
  description: string | null;
  kind: string;
  percent_bp: number | null;
  fixed_amount: number | null;
  fixed_currency: string;
  min_subtotal_amount: number | null;
  min_subtotal_currency: string;
  valid_from: Date | null;
  valid_to: Date | null;
  total_limit: number | null;
  per_phone_limit: number | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deleted_at: Date | null;
}

export interface PromoCodeUsagesTable {
  id: string;
  promo_code_id: string;
  order_id: string;
  phone: string;
  status: string;
  discount_amount: number;
  discount_currency: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CourierDispatchesTable {
  id: string;
  order_id: string;
  branch_id: string;
  provider: string;
  status: string;
  provider_status: string | null;
  external_id: string | null;
  tracking_url: string | null;
  courier_name: string | null;
  courier_phone: string | null;
  price_amount: number | null;
  price_currency: string;
  attempts: number;
  polls: number;
  last_error: string | null;
  requested_at: Date;
  finished_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface OrderingTables {
  'ordering.orders': OrdersTable;
  'ordering.order_items': OrderItemsTable;
  'ordering.order_status_history': OrderStatusHistoryTable;
  'ordering.order_payments': OrderPaymentsTable;
  'ordering.order_refunds': OrderRefundsTable;
  'ordering.delivery_zones': DeliveryZonesTable;
  'ordering.promo_codes': PromoCodesTable;
  'ordering.promo_code_usages': PromoCodeUsagesTable;
  'ordering.courier_dispatches': CourierDispatchesTable;
}
