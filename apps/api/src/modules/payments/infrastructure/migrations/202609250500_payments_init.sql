-- Payments: платежи, возвраты, входящие вебхуки провайдеров, подарочные сертификаты.
-- Все таблицы — в схеме payments. Внешних ключей на таблицы других модулей нет:
-- reference_id (заказ, бронь, счёт банкета, заказ сертификата) и branch_id — просто идентификаторы.
create schema if not exists payments;

-- Номер счёта для провайдера (Halyk ePay требует числовой invoiceID из 6–15 цифр).
create sequence payments.invoice_no_seq start with 100001;

-- ---------------------------------------------------------------- Платежи

create table payments.payments (
  id uuid primary key,
  invoice_no bigint not null default nextval('payments.invoice_no_seq'),
  purpose text not null check (purpose in ('order', 'reservation_deposit', 'banquet_invoice', 'gift_certificate')),
  reference_id text not null,
  branch_id uuid,
  method text not null check (method in ('online', 'on_receipt', 'gift_certificate', 'bank_transfer')),
  -- Имя провайдера (адаптера) для online; для остальных способов совпадает со способом оплаты.
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  status text not null check (status in ('created', 'pending', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  payment_amount bigint not null check (payment_amount > 0),
  payment_currency char(3) not null default 'KZT',
  refunded_amount bigint not null default 0,
  refunded_currency char(3) not null default 'KZT',
  external_id text,
  payment_url text,
  provider_data jsonb not null default '{}'::jsonb,
  description text not null,
  customer_phone text,
  customer_name text,
  customer_email text,
  return_url text,
  idempotency_key text not null,
  certificate_id uuid,
  document_number text,
  failure_reason text,
  cancel_reason text,
  initiate_attempts integer not null default 0,
  last_checked_at timestamptz,
  expiry_check_at timestamptz,
  amount_mismatch_at timestamptz,
  expires_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Инвариант: сумма возвратов не превышает сумму платежа.
  constraint payments_refunded_le_amount check (refunded_amount >= 0 and refunded_amount <= payment_amount),
  constraint payments_refunded_currency check (refunded_currency = payment_currency),
  constraint payments_certificate_required check (method <> 'gift_certificate' or certificate_id is not null)
);
create unique index payments_idempotency_uq on payments.payments (idempotency_key);
create unique index payments_invoice_no_uq on payments.payments (invoice_no);
-- Внешний id уникален в пределах провайдера: повтор не создаёт второй платёж.
create unique index payments_external_uq on payments.payments (provider, external_id) where external_id is not null;
create index payments_reference_idx on payments.payments (purpose, reference_id);
create index payments_branch_idx on payments.payments (branch_id, created_at desc);
create index payments_created_idx on payments.payments (created_at desc);
create index payments_open_idx on payments.payments (status, expires_at) where status in ('created', 'pending');
create trigger payments_touch before update on payments.payments
  for each row execute function platform.touch_updated_at();
create trigger payments_forbid_delete before delete on payments.payments
  for each row execute function platform.forbid_delete();

-- ---------------------------------------------------------------- Возвраты

create table payments.refunds (
  id uuid primary key,
  payment_id uuid not null references payments.payments (id),
  refund_amount bigint not null check (refund_amount > 0),
  refund_currency char(3) not null default 'KZT',
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  -- gateway — через провайдера (очередь), certificate — обратно на сертификат,
  -- manual — наличные/перевод: подтверждает финансист вручную.
  mode text not null check (mode in ('gateway', 'certificate', 'manual')),
  reason text not null,
  idempotency_key text not null,
  external_refund_id text,
  attempts integer not null default 0,
  claimed_at timestamptz,
  failure_reason text,
  comment text,
  requested_by uuid,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index refunds_idempotency_uq on payments.refunds (idempotency_key);
create index refunds_payment_idx on payments.refunds (payment_id);
create index refunds_status_idx on payments.refunds (status, created_at);
create trigger refunds_touch before update on payments.refunds
  for each row execute function platform.touch_updated_at();
create trigger refunds_forbid_delete before delete on payments.refunds
  for each row execute function platform.forbid_delete();

-- ---------------------------------------------------------------- Входящие вебхуки (идемпотентность)

create table payments.webhook_events (
  id uuid primary key,
  provider text not null,
  event_id text not null,
  payment_id uuid,
  external_id text,
  status text not null,
  reported_amount bigint,
  reported_currency char(3) not null default 'KZT',
  outcome text not null check (outcome in ('applied', 'ignored', 'unknown_payment', 'amount_mismatch')),
  received_at timestamptz not null default now()
);
-- Повторный вебхук с тем же идентификатором не меняет состояние второй раз.
create unique index webhook_events_uq on payments.webhook_events (provider, event_id);
create index webhook_events_payment_idx on payments.webhook_events (payment_id, received_at desc);

-- ---------------------------------------------------------------- Песочница (эмуляция провайдера для dev/staging)

create table payments.sandbox_sessions (
  external_id text primary key,
  payment_id uuid not null,
  session_amount bigint not null check (session_amount > 0),
  session_currency char(3) not null default 'KZT',
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  refunded_amount bigint not null default 0,
  refunded_currency char(3) not null default 'KZT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sandbox_sessions_touch before update on payments.sandbox_sessions
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Продукты сертификатов

create table payments.certificate_products (
  id uuid primary key,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  kind text not null check (kind in ('amount', 'set')),
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  nominal_amount bigint not null check (nominal_amount > 0),
  nominal_currency char(3) not null default 'KZT',
  price_amount bigint not null check (price_amount >= 0),
  price_currency char(3) not null default 'KZT',
  validity_months integer not null default 12 check (validity_months between 1 and 60),
  design jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index certificate_products_slug_uq on payments.certificate_products (slug) where deleted_at is null;
create trigger certificate_products_touch before update on payments.certificate_products
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Заказы сертификатов (покупка онлайн / корпоративная продажа)

create table payments.certificate_orders (
  id uuid primary key,
  token text not null,
  source text not null check (source in ('online', 'manual')),
  product_id uuid not null references payments.certificate_products (id),
  product_snapshot jsonb not null,
  quantity integer not null check (quantity between 1 and 500),
  unit_price_amount bigint not null check (unit_price_amount >= 0),
  unit_price_currency char(3) not null default 'KZT',
  total_amount bigint not null check (total_amount > 0),
  total_currency char(3) not null default 'KZT',
  buyer_name text not null,
  buyer_phone text,
  buyer_email text,
  buyer_company text,
  recipient_name text not null,
  recipient_email text,
  recipient_phone text,
  message text,
  delivery_channel text not null check (delivery_channel in ('email', 'whatsapp', 'none')),
  locale text not null check (locale in ('kk', 'ru', 'en')),
  status text not null check (status in ('awaiting_payment', 'issued', 'payment_failed')),
  payment_id uuid,
  idempotency_key text not null,
  consent_version text,
  client_ip text,
  created_by uuid,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index certificate_orders_token_uq on payments.certificate_orders (token);
create unique index certificate_orders_idempotency_uq on payments.certificate_orders (idempotency_key);
create index certificate_orders_buyer_idx on payments.certificate_orders (buyer_phone);
create trigger certificate_orders_touch before update on payments.certificate_orders
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Подарочные сертификаты

-- Полный код не хранится: только HMAC-хэш (с ключом приложения) и последние 4 символа.
create table payments.gift_certificates (
  id uuid primary key,
  code_hash text not null,
  last4 char(4) not null,
  order_id uuid not null references payments.certificate_orders (id),
  product_id uuid not null,
  kind text not null check (kind in ('amount', 'set')),
  name jsonb not null,
  set_description jsonb,
  nominal_amount bigint not null check (nominal_amount > 0),
  nominal_currency char(3) not null default 'KZT',
  balance_amount bigint not null,
  balance_currency char(3) not null default 'KZT',
  price_amount bigint not null check (price_amount >= 0),
  price_currency char(3) not null default 'KZT',
  status text not null check (status in ('active', 'redeemed', 'expired', 'blocked')),
  status_reason text,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  buyer_name text,
  buyer_phone text,
  buyer_email text,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  message text,
  delivery_channel text not null check (delivery_channel in ('email', 'whatsapp', 'none')),
  locale text not null check (locale in ('kk', 'ru', 'en')),
  pdf_file_key text,
  delivery_count integer not null default 0,
  last_delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Инвариант: остаток не уходит в минус и не превышает номинал.
  constraint gift_certificates_balance_non_negative check (balance_amount >= 0),
  constraint gift_certificates_balance_le_nominal check (balance_amount <= nominal_amount)
);
create unique index gift_certificates_code_uq on payments.gift_certificates (code_hash);
create index gift_certificates_last4_idx on payments.gift_certificates (last4);
create index gift_certificates_buyer_idx on payments.gift_certificates (buyer_phone);
create index gift_certificates_order_idx on payments.gift_certificates (order_id);
create index gift_certificates_expiry_idx on payments.gift_certificates (expires_at) where status = 'active';
create trigger gift_certificates_touch before update on payments.gift_certificates
  for each row execute function platform.touch_updated_at();
create trigger gift_certificates_forbid_delete before delete on payments.gift_certificates
  for each row execute function platform.forbid_delete();

-- Журнал движений по сертификату (только добавление): выпуск, списание, возврат, сгорание, восстановление.
create table payments.certificate_transactions (
  id uuid primary key,
  certificate_id uuid not null references payments.gift_certificates (id),
  kind text not null check (kind in ('issue', 'debit', 'credit', 'expire', 'reinstate')),
  change_amount bigint not null check (change_amount >= 0),
  change_currency char(3) not null default 'KZT',
  balance_after_amount bigint not null check (balance_after_amount >= 0),
  balance_after_currency char(3) not null default 'KZT',
  channel text not null check (channel in ('order', 'point', 'refund', 'sale', 'system', 'admin')),
  payment_id uuid,
  refund_id uuid,
  reference_type text,
  reference_id text,
  branch_id uuid,
  actor_user_id uuid,
  actor_name text not null,
  comment text,
  occurred_at timestamptz not null
);
create index certificate_transactions_cert_idx on payments.certificate_transactions (certificate_id, occurred_at);
create index certificate_transactions_time_idx on payments.certificate_transactions (occurred_at, kind);
create trigger certificate_transactions_append_only before update or delete on payments.certificate_transactions
  for each row execute function platform.forbid_update_delete();

-- ---------------------------------------------------------------- Защита от подбора кодов

create table payments.certificate_check_failures (
  id uuid primary key,
  ip text not null,
  occurred_at timestamptz not null
);
create index certificate_check_failures_ip_idx on payments.certificate_check_failures (ip, occurred_at desc);
create index certificate_check_failures_time_idx on payments.certificate_check_failures (occurred_at);

create table payments.certificate_ip_blocks (
  ip text primary key,
  blocked_until timestamptz not null,
  failures integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger certificate_ip_blocks_touch before update on payments.certificate_ip_blocks
  for each row execute function platform.touch_updated_at();
