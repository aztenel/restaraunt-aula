-- Reservation: типы мест (справочник), залы, места, брони, история статусов, настройки брони по филиалам.
-- Пересечение интервалов по одному месту невозможно: блокировка строки места в транзакции брони
-- + exclusion constraint (btree_gist) по (venue_id, blocked_range) для занимающих статусов.
create schema if not exists reservation;
create extension if not exists btree_gist;

-- Типы мест: стол, VIP-зал, юрта, терраса... Конфигурируются, а не зашиты в код.
-- Правила по умолчанию для мест этого типа (место может переопределить любое правило).
create table reservation.venue_types (
  id uuid primary key,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  duration_minutes integer not null check (duration_minutes between 15 and 1440),
  hold_minutes integer not null check (hold_minutes between 1 and 10080),
  cancellation_deadline_hours integer not null check (cancellation_deadline_hours between 0 and 720),
  requires_manual_confirmation boolean not null default false,
  cleanup_minutes integer not null default 0 check (cleanup_minutes between 0 and 720),
  slot_step_minutes integer not null default 30 check (slot_step_minutes between 5 and 240),
  bookable_online boolean not null default true,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index venue_types_code_uq on reservation.venue_types (code) where deleted_at is null;
create trigger venue_types_touch before update on reservation.venue_types
  for each row execute function platform.touch_updated_at();

-- Залы филиала: карта (размер плана в условных единицах, фон).
create table reservation.halls (
  id uuid primary key,
  branch_id uuid not null,
  code text not null check (code ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  plan_width integer not null default 1000 check (plan_width between 100 and 10000),
  plan_height integer not null default 600 check (plan_height between 100 and 10000),
  background_image jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index halls_code_uq on reservation.halls (branch_id, code) where deleted_at is null;
create index halls_branch_idx on reservation.halls (branch_id) where deleted_at is null;
create trigger halls_touch before update on reservation.halls
  for each row execute function platform.touch_updated_at();

-- Места: стол, VIP-зал, юрта... Вместимость, депозит, переопределения правил типа, позиция на карте зала.
create table reservation.venues (
  id uuid primary key,
  branch_id uuid not null,
  hall_id uuid not null references reservation.halls (id),
  type_id uuid not null references reservation.venue_types (id),
  code text not null check (code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$'),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  capacity_min integer not null check (capacity_min >= 1),
  capacity_max integer not null check (capacity_max >= capacity_min and capacity_max <= 1000),
  deposit_amount bigint check (deposit_amount is null or deposit_amount > 0),
  deposit_currency char(3) not null default 'KZT',
  rules jsonb not null default '{}'::jsonb,
  pos_x integer not null default 0 check (pos_x >= 0),
  pos_y integer not null default 0 check (pos_y >= 0),
  pos_w integer not null default 60 check (pos_w >= 1),
  pos_h integer not null default 60 check (pos_h >= 1),
  shape text not null default 'rect' check (shape in ('rect', 'circle')),
  rotation integer not null default 0 check (rotation between 0 and 359),
  photos jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index venues_code_uq on reservation.venues (branch_id, code) where deleted_at is null;
create index venues_branch_idx on reservation.venues (branch_id) where deleted_at is null;
create index venues_hall_idx on reservation.venues (hall_id) where deleted_at is null;
create index venues_type_idx on reservation.venues (type_id) where deleted_at is null;
create trigger venues_touch before update on reservation.venues
  for each row execute function platform.touch_updated_at();

-- Брони и занятость мест под банкеты (kind = banquet).
-- Интервал занятости: [start_at, blocked_until), где blocked_until = end_at + буфер уборки места.
create table reservation.reservations (
  id uuid primary key,
  number text not null,
  branch_id uuid not null,
  venue_id uuid not null references reservation.venues (id),
  kind text not null check (kind in ('regular', 'banquet')),
  status text not null check (status in ('pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show', 'cancelled', 'expired')),
  source text not null check (source in ('web', 'admin', 'banquet')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  blocked_until timestamptz not null,
  blocked_range tstzrange generated always as (tstzrange(start_at, blocked_until, '[)')) stored,
  guests integer not null check (guests between 1 and 1000),
  customer_id uuid,
  customer_name text,
  customer_phone text,
  customer_email text,
  comment text,
  occasion text,
  locale text not null default 'ru' check (locale in ('kk', 'ru', 'en')),
  public_token text,
  idempotency_key text,
  banquet_request_id uuid,
  note text,
  requires_confirmation boolean not null default false,
  -- Действующие правила места на момент брони (или последнего переноса): дедлайн отмены, удержание...
  rules jsonb not null default '{}'::jsonb,
  hold_expires_at timestamptz,
  deposit_amount bigint check (deposit_amount is null or deposit_amount > 0),
  deposit_currency char(3) not null default 'KZT',
  deposit_status text not null default 'none'
    check (deposit_status in ('none', 'waived', 'pending', 'unpaid', 'paid', 'refund_pending', 'refunded', 'refund_failed', 'retained', 'applied')),
  deposit_payment_id uuid,
  deposit_paid_payment_id uuid,
  deposit_paid_at timestamptz,
  deposit_waive_reason text,
  deposit_attempts integer not null default 0,
  deposit_outcome text not null default 'none' check (deposit_outcome in ('none', 'refunded', 'retained')),
  cancel_reason text,
  cancelled_by text check (cancelled_by in ('guest', 'staff', 'system', 'banquet')),
  confirmed_at timestamptz,
  arrived_at timestamptz,
  no_show_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  reminder_sent_at timestamptz,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint reservations_interval_chk check (end_at > start_at and blocked_until >= end_at),
  constraint reservations_banquet_chk check ((kind = 'banquet') = (banquet_request_id is not null)),
  -- Пересечение интервалов по одному месту невозможно (вторая линия защиты после блокировки места).
  constraint reservations_no_overlap exclude using gist (venue_id with =, blocked_range with &&)
    where (status in ('pending', 'awaiting_deposit', 'confirmed', 'arrived') and deleted_at is null)
);
create unique index reservations_number_uq on reservation.reservations (number);
create unique index reservations_token_uq on reservation.reservations (public_token) where public_token is not null;
create unique index reservations_idempotency_uq on reservation.reservations (idempotency_key) where idempotency_key is not null;
create index reservations_branch_start_idx on reservation.reservations (branch_id, start_at);
create index reservations_venue_start_idx on reservation.reservations (venue_id, start_at);
create index reservations_hold_idx on reservation.reservations (hold_expires_at) where status in ('pending', 'awaiting_deposit');
create index reservations_banquet_idx on reservation.reservations (banquet_request_id) where banquet_request_id is not null;
create index reservations_phone_idx on reservation.reservations (customer_phone);
create index reservations_customer_idx on reservation.reservations (customer_id) where customer_id is not null;
create index reservations_deposit_payment_idx on reservation.reservations (deposit_payment_id) where deposit_payment_id is not null;
create trigger reservations_touch before update on reservation.reservations
  for each row execute function platform.touch_updated_at();
-- Физическое удаление броней запрещено (только логическое, deleted_at).
create trigger reservations_forbid_delete before delete on reservation.reservations
  for each row execute function platform.forbid_delete();

-- История статусов брони (только добавление): кто, когда, из какого статуса, причина.
create table reservation.status_history (
  id uuid primary key,
  reservation_id uuid not null references reservation.reservations (id),
  from_status text,
  to_status text not null,
  reason text,
  deposit_outcome text not null default 'none' check (deposit_outcome in ('none', 'refunded', 'retained')),
  actor_kind text not null,
  actor_user_id uuid,
  actor_name text not null,
  occurred_at timestamptz not null
);
create index status_history_reservation_idx on reservation.status_history (reservation_id, occurred_at);
create trigger status_history_append_only before update or delete on reservation.status_history
  for each row execute function platform.forbid_update_delete();

-- Настройки бронирования филиала (принадлежат модулю Reservation).
create table reservation.branch_settings (
  branch_id uuid primary key,
  reminder_hours_before integer not null default 3 check (reminder_hours_before between 0 and 72),
  min_lead_minutes integer not null default 60 check (min_lead_minutes between 0 and 10080),
  max_days_ahead integer not null default 60 check (max_days_ahead between 1 and 365),
  policy_text jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create trigger branch_settings_touch before update on reservation.branch_settings
  for each row execute function platform.touch_updated_at();
