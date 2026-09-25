-- Ordering: заказы доставки и самовывоза, позиции (снимки), история статусов, связи с платежами
-- и возвратами, зоны доставки, промокоды и их использования, заявки на курьера.
create schema if not exists ordering;

-- Заказ. Жизненный цикл — конечный автомат строго по схеме ТЗ (ordering/domain/order-status.ts).
-- Итог всегда считается на сервере; суммы — в тиынах вместе с валютой.
create table ordering.orders (
  id uuid primary key,
  number text not null,
  public_token text not null,
  branch_id uuid not null,
  type text not null check (type in ('delivery', 'pickup')),
  channel text not null check (channel in ('web', 'admin')),
  status text not null check (
    status in ('draft', 'awaiting_payment', 'paid', 'accepted', 'cooking', 'ready', 'delivering', 'completed', 'cancelled', 'refunded')
  ),
  customer_id uuid,
  customer_name text,
  customer_phone text not null,
  customer_email text,
  delivery_lat double precision,
  delivery_lng double precision,
  delivery_address text,
  delivery_apartment text,
  delivery_entrance text,
  delivery_floor text,
  delivery_intercom text,
  delivery_courier_comment text,
  delivery_zone_id uuid,
  contactless boolean not null default false,
  scheduled_for timestamptz,
  eta_minutes integer not null check (eta_minutes >= 0),
  promised_at timestamptz not null,
  comment text,
  promo_code_id uuid,
  promo_code text,
  promo_kind text check (promo_kind in ('percent', 'fixed', 'free_delivery')),
  certificate_masked_code text,
  payment_method text not null check (payment_method in ('online', 'on_receipt')),
  current_payment_id uuid,
  subtotal_amount bigint not null check (subtotal_amount >= 0),
  subtotal_currency char(3) not null default 'KZT',
  discount_amount bigint not null check (discount_amount >= 0),
  discount_currency char(3) not null default 'KZT',
  delivery_fee_amount bigint not null check (delivery_fee_amount >= 0),
  delivery_fee_currency char(3) not null default 'KZT',
  total_amount bigint not null check (total_amount >= 0),
  total_currency char(3) not null default 'KZT',
  locale text not null check (locale in ('kk', 'ru', 'en')),
  analytics_session_id text,
  idempotency_key text not null,
  created_by uuid,
  cancel_reason_code text check (
    cancel_reason_code in ('guest_request', 'not_paid_in_time', 'out_of_stock', 'cannot_deliver', 'duplicate', 'other')
  ),
  cancel_reason text,
  was_paid boolean not null default false,
  placed_at timestamptz not null,
  paid_at timestamptz,
  accepted_at timestamptz,
  cooking_at timestamptz,
  ready_at timestamptz,
  delivering_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (discount_amount <= subtotal_amount),
  check (type = 'pickup' or (delivery_lat is not null and delivery_lng is not null and delivery_address is not null))
);
create unique index orders_number_uq on ordering.orders (number);
create unique index orders_public_token_uq on ordering.orders (public_token);
create unique index orders_idempotency_key_uq on ordering.orders (idempotency_key);
create index orders_branch_status_idx on ordering.orders (branch_id, status, placed_at desc);
create index orders_placed_idx on ordering.orders (placed_at desc);
create index orders_phone_idx on ordering.orders (customer_phone);
create index orders_customer_idx on ordering.orders (customer_id);
create index orders_awaiting_payment_idx on ordering.orders (branch_id, placed_at) where status = 'awaiting_payment';
create trigger orders_touch before update on ordering.orders
  for each row execute function platform.touch_updated_at();
create trigger orders_forbid_delete before delete on ordering.orders
  for each row execute function platform.forbid_delete();

-- Позиции заказа — снимок названия, цены и модификаторов на момент заказа:
-- изменение меню не меняет прошлые заказы.
create table ordering.order_items (
  id uuid primary key,
  order_id uuid not null references ordering.orders (id),
  position integer not null,
  dish_id uuid not null,
  dish_slug text not null,
  category_id text,
  sku text,
  name jsonb not null,
  photo_url text,
  weight_grams integer,
  quantity integer not null check (quantity between 1 and 99),
  base_price_amount bigint not null check (base_price_amount >= 0),
  base_price_currency char(3) not null default 'KZT',
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  unit_price_currency char(3) not null default 'KZT',
  line_total_amount bigint not null check (line_total_amount >= 0),
  line_total_currency char(3) not null default 'KZT',
  modifiers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create unique index order_items_position_uq on ordering.order_items (order_id, position);
create index order_items_dish_idx on ordering.order_items (dish_id);
create trigger order_items_forbid_delete before delete on ordering.order_items
  for each row execute function platform.forbid_delete();

-- История статусов заказа (таймлайн для гостя и админки).
create table ordering.order_status_history (
  id uuid primary key,
  order_id uuid not null references ordering.orders (id),
  from_status text,
  to_status text not null,
  occurred_at timestamptz not null,
  actor_kind text not null check (actor_kind in ('staff', 'system', 'guest')),
  actor_user_id uuid,
  actor_name text not null,
  reason_code text,
  reason text
);
create index order_status_history_order_idx on ordering.order_status_history (order_id, occurred_at);
create trigger order_status_history_forbid_delete before delete on ordering.order_status_history
  for each row execute function platform.forbid_delete();

-- Платежи заказа (сам платёж живёт в модуле Payments; здесь — связь и назначение части суммы).
create table ordering.order_payments (
  payment_id uuid primary key,
  order_id uuid not null references ordering.orders (id),
  kind text not null check (kind in ('certificate', 'online', 'on_receipt')),
  attempt integer not null default 1,
  amount_amount bigint not null check (amount_amount >= 0),
  amount_currency char(3) not null default 'KZT',
  created_at timestamptz not null default now()
);
create index order_payments_order_idx on ordering.order_payments (order_id, created_at);
create trigger order_payments_forbid_delete before delete on ordering.order_payments
  for each row execute function platform.forbid_delete();

-- Запрошенные возвраты по заказу: когда все возвраты отменённого заказа прошли — cancelled -> refunded.
create table ordering.order_refunds (
  refund_id uuid primary key,
  order_id uuid not null references ordering.orders (id),
  payment_id uuid not null,
  -- cancellation — при отмене; partial — частичный (недовложение); late_payment — оплата пришла после отмены;
  -- duplicate_payment — лишний платёж; external — возврат запрошен вне заказа (раздел платежей админки).
  kind text not null check (kind in ('cancellation', 'partial', 'late_payment', 'duplicate_payment', 'external')),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  amount_amount bigint not null check (amount_amount > 0),
  amount_currency char(3) not null default 'KZT',
  reason text not null,
  requested_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index order_refunds_order_idx on ordering.order_refunds (order_id);
create index order_refunds_payment_idx on ordering.order_refunds (payment_id);
create trigger order_refunds_touch before update on ordering.order_refunds
  for each row execute function platform.touch_updated_at();
create trigger order_refunds_forbid_delete before delete on ordering.order_refunds
  for each row execute function platform.forbid_delete();

-- Зоны доставки филиала: полигон (JSONB, массив точек), минимальная сумма, стоимость, «бесплатно от».
-- Зоны одного филиала не пересекаются (проверка в домене под advisory-блокировкой филиала).
create table ordering.delivery_zones (
  id uuid primary key,
  branch_id uuid not null,
  name jsonb not null,
  polygon jsonb not null,
  min_order_amount bigint not null check (min_order_amount >= 0),
  min_order_currency char(3) not null default 'KZT',
  delivery_fee_amount bigint not null check (delivery_fee_amount >= 0),
  delivery_fee_currency char(3) not null default 'KZT',
  free_delivery_from_amount bigint check (free_delivery_from_amount is null or free_delivery_from_amount >= 0),
  free_delivery_from_currency char(3) not null default 'KZT',
  eta_minutes integer not null check (eta_minutes between 1 and 600),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index delivery_zones_branch_idx on ordering.delivery_zones (branch_id, sort_order) where deleted_at is null;
create trigger delivery_zones_touch before update on ordering.delivery_zones
  for each row execute function platform.touch_updated_at();

-- Промокоды: процент (базисные пункты), фиксированная сумма или бесплатная доставка.
create table ordering.promo_codes (
  id uuid primary key,
  code text not null check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text,
  kind text not null check (kind in ('percent', 'fixed', 'free_delivery')),
  percent_bp integer check (percent_bp is null or (percent_bp between 1 and 10000)),
  fixed_amount bigint check (fixed_amount is null or fixed_amount > 0),
  fixed_currency char(3) not null default 'KZT',
  min_subtotal_amount bigint check (min_subtotal_amount is null or min_subtotal_amount >= 0),
  min_subtotal_currency char(3) not null default 'KZT',
  valid_from timestamptz,
  valid_to timestamptz,
  total_limit integer check (total_limit is null or total_limit > 0),
  per_phone_limit integer check (per_phone_limit is null or per_phone_limit > 0),
  branch_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (kind <> 'percent' or percent_bp is not null),
  check (kind <> 'fixed' or fixed_amount is not null),
  check (valid_from is null or valid_to is null or valid_from < valid_to)
);
create unique index promo_codes_code_uq on ordering.promo_codes (code) where deleted_at is null;
create index promo_codes_branch_idx on ordering.promo_codes (branch_id) where deleted_at is null;
create trigger promo_codes_touch before update on ordering.promo_codes
  for each row execute function platform.touch_updated_at();

-- Использования промокода: reserved при оформлении, used после оплаты, released при отмене до оплаты.
create table ordering.promo_code_usages (
  id uuid primary key,
  promo_code_id uuid not null references ordering.promo_codes (id),
  order_id uuid not null references ordering.orders (id),
  phone text not null,
  status text not null check (status in ('reserved', 'used', 'released')),
  discount_amount bigint not null check (discount_amount >= 0),
  discount_currency char(3) not null default 'KZT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index promo_code_usages_order_uq on ordering.promo_code_usages (order_id);
create index promo_code_usages_promo_idx on ordering.promo_code_usages (promo_code_id, status);
create index promo_code_usages_phone_idx on ordering.promo_code_usages (promo_code_id, phone) where status <> 'released';
create trigger promo_code_usages_touch before update on ordering.promo_code_usages
  for each row execute function platform.touch_updated_at();

-- Заявки на курьера внешней службы доставки (интерфейс CourierDispatch). Свои курьеры заявок не создают.
create table ordering.courier_dispatches (
  id uuid primary key,
  order_id uuid not null references ordering.orders (id),
  branch_id uuid not null,
  provider text not null,
  status text not null check (
    status in ('requested', 'estimating', 'awaiting_confirmation', 'searching', 'courier_assigned', 'picked_up', 'delivered', 'cancelled', 'failed')
  ),
  provider_status text,
  external_id text,
  tracking_url text,
  courier_name text,
  courier_phone text,
  price_amount bigint,
  price_currency char(3) not null default 'KZT',
  attempts integer not null default 0,
  polls integer not null default 0,
  last_error text,
  requested_at timestamptz not null,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index courier_dispatches_order_idx on ordering.courier_dispatches (order_id, requested_at desc);
create unique index courier_dispatches_active_uq on ordering.courier_dispatches (order_id)
  where status not in ('delivered', 'cancelled', 'failed');
create trigger courier_dispatches_touch before update on ordering.courier_dispatches
  for each row execute function platform.touch_updated_at();
