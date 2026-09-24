-- Reporting: модуль только чтения. Собственные проекции, построенные из событий других модулей
-- (идемпотентные upsert по идентификаторам источника), факты выручки, аналитика витрины,
-- дневные отчёты и выгрузки в учёт (1С). Все таблицы — в схеме reporting.
-- Внешних ключей на таблицы других модулей нет: order_id, payment_id, branch_id и т.п. —
-- просто идентификаторы из событий. Локальные даты (*_date) — в Asia/Almaty.
create schema if not exists reporting;

-- ---------------------------------------------------------------- Заказы (события Ordering)

create table reporting.orders (
  order_id uuid primary key,
  number text not null,
  branch_id uuid not null,
  type text not null check (type in ('delivery', 'pickup')),
  channel text not null check (channel in ('web', 'admin')),
  status text not null check (
    status in ('draft', 'awaiting_payment', 'paid', 'accepted', 'cooking', 'ready', 'delivering', 'completed', 'cancelled', 'refunded')
  ),
  -- Момент и ранг последнего применённого статуса: события могут прийти не по порядку,
  -- более старое событие не перетирает более новый статус.
  status_at timestamptz not null,
  status_rank smallint not null,
  customer_id uuid,
  payment_method text check (payment_method in ('online', 'on_receipt')),
  promo_code text,
  analytics_session_id text,
  subtotal_amount bigint not null default 0,
  subtotal_currency char(3) not null default 'KZT',
  discount_amount bigint not null default 0,
  discount_currency char(3) not null default 'KZT',
  delivery_fee_amount bigint not null default 0,
  delivery_fee_currency char(3) not null default 'KZT',
  total_amount bigint not null default 0,
  total_currency char(3) not null default 'KZT',
  placed_at timestamptz,
  placed_date date,
  completed_at timestamptz,
  completed_date date,
  cancelled_at timestamptz,
  cancelled_date date,
  cancel_reason_code text,
  cancel_reason text,
  was_paid boolean,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_placed_idx on reporting.orders (placed_date, branch_id);
create index orders_completed_idx on reporting.orders (completed_date, branch_id) where completed_date is not null;
create index orders_cancelled_idx on reporting.orders (cancelled_date, branch_id) where cancelled_date is not null;
create index orders_session_idx on reporting.orders (analytics_session_id) where analytics_session_id is not null;
create trigger orders_touch before update on reporting.orders
  for each row execute function platform.touch_updated_at();
create trigger orders_forbid_delete before delete on reporting.orders
  for each row execute function platform.forbid_delete();

-- Позиции выполненных заказов (снимок из OrderCompleted) — для топа блюд и выгрузки в учёт.
create table reporting.order_items (
  order_id uuid not null,
  line_no integer not null,
  dish_id uuid not null,
  name jsonb not null,
  quantity integer not null check (quantity > 0),
  unit_price_amount bigint not null,
  unit_price_currency char(3) not null default 'KZT',
  line_total_amount bigint not null,
  line_total_currency char(3) not null default 'KZT',
  primary key (order_id, line_no)
);
create index order_items_dish_idx on reporting.order_items (dish_id);

-- ---------------------------------------------------------------- Платежи и возвраты (события Payments)

create table reporting.payments (
  payment_id uuid primary key,
  purpose text not null check (purpose in ('order', 'reservation_deposit', 'banquet_invoice', 'gift_certificate')),
  reference_id text not null,
  branch_id uuid,
  method text not null check (method in ('online', 'on_receipt', 'gift_certificate', 'bank_transfer')),
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  payment_amount bigint not null check (payment_amount >= 0),
  payment_currency char(3) not null default 'KZT',
  paid_at timestamptz not null,
  paid_date date not null,
  -- Поздняя оплата: провайдер подтвердил списание после отмены/отказа платежа.
  late boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payments_reference_idx on reporting.payments (purpose, reference_id);
create index payments_date_idx on reporting.payments (paid_date, branch_id);
create trigger payments_touch before update on reporting.payments
  for each row execute function platform.touch_updated_at();
create trigger payments_forbid_delete before delete on reporting.payments
  for each row execute function platform.forbid_delete();

create table reporting.refunds (
  refund_id uuid primary key,
  payment_id uuid not null,
  purpose text not null check (purpose in ('order', 'reservation_deposit', 'banquet_invoice', 'gift_certificate')),
  reference_id text not null,
  branch_id uuid,
  refund_amount bigint not null check (refund_amount > 0),
  refund_currency char(3) not null default 'KZT',
  reason text not null default '',
  refunded_at timestamptz not null,
  refunded_date date not null,
  payment_fully_refunded boolean not null default false,
  reference_fully_refunded boolean not null default false,
  created_at timestamptz not null default now()
);
create index refunds_reference_idx on reporting.refunds (purpose, reference_id);
create index refunds_payment_idx on reporting.refunds (payment_id);
create index refunds_date_idx on reporting.refunds (refunded_date, branch_id);
create trigger refunds_forbid_delete before delete on reporting.refunds
  for each row execute function platform.forbid_delete();

-- ---------------------------------------------------------------- Факты выручки

-- Строки выручки по правилам признания (docs/decisions.md «Отчётность»): заказ — при completed,
-- банкет — при held (итог сметы), сертификат — при продаже; возврат по уже признанной выручке —
-- отрицательная строка в день возврата. Одна строка на источник (идемпотентность).
create table reporting.sales_facts (
  id uuid primary key,
  source_type text not null check (source_type in ('order', 'banquet', 'certificate', 'refund')),
  source_id text not null,
  kind text not null check (kind in ('sale', 'refund')),
  channel text not null check (channel in ('delivery', 'pickup', 'banquet', 'certificate')),
  branch_id uuid,
  -- Для заказов: свой сайт (web) или оператор по телефону (admin).
  order_channel text check (order_channel in ('web', 'admin')),
  reference_id text not null,
  occurred_at timestamptz not null,
  local_date date not null,
  revenue_amount bigint not null,
  revenue_currency char(3) not null default 'KZT',
  created_at timestamptz not null default now(),
  constraint sales_facts_sign check ((kind = 'sale' and revenue_amount >= 0) or (kind = 'refund' and revenue_amount <= 0))
);
create unique index sales_facts_source_uq on reporting.sales_facts (source_type, source_id);
create index sales_facts_date_idx on reporting.sales_facts (local_date, channel);
create index sales_facts_branch_idx on reporting.sales_facts (branch_id, local_date);

-- ---------------------------------------------------------------- Брони (события Reservation)

create table reporting.reservations (
  reservation_id uuid primary key,
  number text not null,
  branch_id uuid not null,
  venue_id uuid not null,
  venue_type_code text not null,
  venue_name jsonb,
  kind text not null check (kind in ('regular', 'banquet')),
  status text not null check (status in ('pending', 'awaiting_deposit', 'confirmed', 'arrived', 'no_show', 'cancelled', 'expired')),
  status_at timestamptz not null,
  status_rank smallint not null,
  source text check (source in ('web', 'admin', 'banquet')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  start_date date not null,
  guests integer not null check (guests >= 0),
  banquet_request_id uuid,
  deposit_amount bigint,
  deposit_currency char(3) not null default 'KZT',
  deposit_outcome text not null default 'none' check (deposit_outcome in ('none', 'refunded', 'retained')),
  booked_at timestamptz,
  booked_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reservations_interval check (end_at > start_at)
);
create index reservations_start_idx on reporting.reservations (start_date, branch_id);
create index reservations_booked_idx on reporting.reservations (booked_date, branch_id);
create index reservations_venue_idx on reporting.reservations (venue_id, start_at);
create trigger reservations_touch before update on reporting.reservations
  for each row execute function platform.touch_updated_at();
create trigger reservations_forbid_delete before delete on reporting.reservations
  for each row execute function platform.forbid_delete();

-- ---------------------------------------------------------------- Банкеты (события Banquet)

create table reporting.banquet_requests (
  request_id uuid primary key,
  number text not null,
  branch_id uuid,
  is_offsite boolean not null default false,
  event_date date,
  event_type text,
  guests integer,
  budget_amount bigint,
  budget_currency char(3) not null default 'KZT',
  manager_id uuid,
  manager_at timestamptz,
  source text check (source in ('web', 'admin')),
  status text not null check (status in ('new', 'in_progress', 'quote_sent', 'agreed', 'prepaid', 'held', 'cancelled')),
  status_at timestamptz not null,
  status_rank smallint not null,
  -- Максимальная достигнутая стадия воронки (0 = new … 5 = held), для воронки «дошли до стадии».
  max_stage smallint not null default 0,
  requested_at timestamptz,
  requested_date date,
  -- Первый ответ менеджера = первый переход из статуса new.
  first_response_at timestamptz,
  quote_total_amount bigint,
  quote_total_currency char(3) not null default 'KZT',
  held_at timestamptz,
  held_date date,
  held_total_amount bigint,
  held_total_currency char(3) not null default 'KZT',
  cancelled_at timestamptz,
  cancelled_from text,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banquet_requests_requested_idx on reporting.banquet_requests (requested_date, branch_id);
create index banquet_requests_held_idx on reporting.banquet_requests (held_date) where held_date is not null;
create trigger banquet_requests_touch before update on reporting.banquet_requests
  for each row execute function platform.touch_updated_at();

-- История статусов заявки (ключ — id события).
create table reporting.banquet_status_changes (
  event_id uuid primary key,
  request_id uuid not null,
  from_status text not null,
  to_status text not null,
  reason text,
  occurred_at timestamptz not null
);
create index banquet_status_changes_request_idx on reporting.banquet_status_changes (request_id, occurred_at);

-- Документы для учёта: счета и акты по банкетам (из InvoiceIssued / ActIssued).
create table reporting.documents (
  id uuid primary key,
  kind text not null check (kind in ('invoice', 'act')),
  number text not null,
  request_id uuid not null,
  branch_id uuid,
  payer_type text check (payer_type in ('individual', 'company')),
  company_name text,
  company_bin text,
  document_amount bigint not null,
  document_currency char(3) not null default 'KZT',
  vat_amount bigint not null default 0,
  vat_currency char(3) not null default 'KZT',
  paid_total_amount bigint not null default 0,
  paid_total_currency char(3) not null default 'KZT',
  fully_paid boolean not null default false,
  due_date date,
  issued_at timestamptz not null,
  issued_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index documents_request_idx on reporting.documents (request_id);
create index documents_date_idx on reporting.documents (issued_date, kind);
create trigger documents_touch before update on reporting.documents
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Подарочные сертификаты

create table reporting.certificates (
  certificate_id uuid primary key,
  product_id text,
  kind text not null check (kind in ('amount', 'set')),
  nominal_amount bigint not null,
  nominal_currency char(3) not null default 'KZT',
  price_amount bigint,
  price_currency char(3) not null default 'KZT',
  branch_id uuid,
  issued_at timestamptz,
  issued_date date,
  expires_at timestamptz,
  expired_at timestamptz,
  expired_date date,
  -- Несгоревший остаток на момент истечения срока (списывается из обязательств).
  expired_balance_amount bigint,
  expired_balance_currency char(3) not null default 'KZT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index certificates_issued_idx on reporting.certificates (issued_date);
create index certificates_expired_idx on reporting.certificates (expired_date) where expired_date is not null;
create trigger certificates_touch before update on reporting.certificates
  for each row execute function platform.touch_updated_at();

create table reporting.certificate_redemptions (
  event_id uuid primary key,
  certificate_id uuid not null,
  redeemed_amount bigint not null check (redeemed_amount >= 0),
  redeemed_currency char(3) not null default 'KZT',
  balance_after_amount bigint not null,
  balance_after_currency char(3) not null default 'KZT',
  branch_id uuid,
  channel text not null check (channel in ('order', 'point')),
  reference_id text,
  redeemed_at timestamptz not null,
  redeemed_date date not null
);
create index certificate_redemptions_date_idx on reporting.certificate_redemptions (redeemed_date, branch_id);
create index certificate_redemptions_cert_idx on reporting.certificate_redemptions (certificate_id);

-- ---------------------------------------------------------------- Аналитика витрины

-- Без персональных данных: анонимный идентификатор сессии, тип события, путь без параметров.
create table reporting.storefront_events (
  id uuid primary key,
  session_id uuid not null,
  type text not null check (type in ('page_view', 'menu_view', 'dish_view', 'add_to_cart', 'checkout_start')),
  branch_id uuid,
  path text not null,
  occurred_at timestamptz not null,
  local_date date not null
);
create index storefront_events_date_idx on reporting.storefront_events (local_date, session_id);
create index storefront_events_branch_idx on reporting.storefront_events (branch_id, local_date);

-- ---------------------------------------------------------------- Заказы агрегаторов (ручной ввод)

-- Данные агрегаторов вне системы: управляющий вносит помесячные итоги для доли своего канала.
create table reporting.aggregator_volumes (
  id uuid primary key,
  branch_id uuid not null,
  month date not null check (extract(day from month) = 1),
  source text not null check (source ~ '^[a-z0-9_]{2,32}$'),
  source_name text not null,
  orders_count integer not null check (orders_count >= 0),
  revenue_amount bigint not null default 0 check (revenue_amount >= 0),
  revenue_currency char(3) not null default 'KZT',
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index aggregator_volumes_uq on reporting.aggregator_volumes (branch_id, month, source);
create trigger aggregator_volumes_touch before update on reporting.aggregator_volumes
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Дневные отчёты

create table reporting.daily_reports (
  id uuid primary key,
  report_date date not null,
  -- 'all' — сводный по сети, иначе id филиала.
  scope text not null,
  branch_id uuid,
  summary jsonb not null,
  file_key text,
  generated_at timestamptz not null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_reports_scope check ((scope = 'all' and branch_id is null) or (scope = branch_id::text))
);
create unique index daily_reports_uq on reporting.daily_reports (report_date, scope);
create trigger daily_reports_touch before update on reporting.daily_reports
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Выгрузки в учёт (1С)

create table reporting.accounting_exports (
  id uuid primary key,
  format text not null check (format in ('onec_xml', 'xlsx')),
  period_from date not null,
  period_to date not null,
  branch_id uuid,
  status text not null check (status in ('pending', 'ready', 'failed')),
  build_attempts integer not null default 0,
  file_key text,
  file_name text,
  content_type text,
  size_bytes integer,
  totals jsonb,
  error text,
  push_requested boolean not null default true,
  push_status text not null default 'not_required' check (push_status in ('not_required', 'pending', 'pushed', 'failed')),
  push_attempts integer not null default 0,
  pushed_at timestamptz,
  push_error text,
  requested_by uuid,
  requested_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_exports_period check (period_to >= period_from)
);
create index accounting_exports_requested_idx on reporting.accounting_exports (requested_at desc);
create trigger accounting_exports_touch before update on reporting.accounting_exports
  for each row execute function platform.touch_updated_at();
