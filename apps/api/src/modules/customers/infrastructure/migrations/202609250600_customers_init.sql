-- Customers: база гостей. Гость идентифицируется по номеру телефона, нормализованному в +7XXXXXXXXXX.
-- Согласие на обработку ПД фиксируется явно: отдельная запись (только добавление) с датой,
-- версией текста, источником и IP (закон РК «О персональных данных и их защите»).
create schema if not exists customers;

-- Гости. Агрегаты (счётчики, сумма) — проекция событий других модулей (см. customers.activities).
create table customers.customers (
  id uuid primary key,
  phone text not null,
  name text,
  email text,
  locale text not null default 'ru' check (locale in ('kk', 'ru', 'en')),
  birthday date,
  tags text[] not null default '{}',
  allergies text,
  preferences text,
  notes text,
  personal_data_consent boolean not null default false,
  personal_data_consent_version text,
  personal_data_consent_at timestamptz,
  marketing_consent boolean not null default false,
  marketing_consent_version text,
  marketing_consent_at timestamptz,
  first_seen_at timestamptz not null,
  last_activity_at timestamptz,
  orders_count integer not null default 0 check (orders_count >= 0),
  completed_orders_count integer not null default 0 check (completed_orders_count >= 0),
  total_spent_amount bigint not null default 0 check (total_spent_amount >= 0),
  total_spent_currency char(3) not null default 'KZT',
  reservations_count integer not null default 0 check (reservations_count >= 0),
  no_show_count integer not null default 0 check (no_show_count >= 0),
  banquets_count integer not null default 0 check (banquets_count >= 0),
  anonymized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  -- Телефон нормализован; после обезличивания — необратимый маркер 'anon:<hash>'.
  constraint customers_phone_format check (
    phone ~ '^\+7\d{10}$' or (anonymized_at is not null and phone ~ '^anon:[0-9a-f]{64}$')
  ),
  constraint customers_email_lower check (email is null or email = lower(email))
);
create unique index customers_phone_uq on customers.customers (phone) where deleted_at is null;
create index customers_tags_idx on customers.customers using gin (tags);
create index customers_name_trgm_idx on customers.customers using gin (lower(name) gin_trgm_ops);
create index customers_email_trgm_idx on customers.customers using gin (email gin_trgm_ops);
create index customers_last_activity_idx on customers.customers (last_activity_at desc nulls last);
create index customers_total_spent_idx on customers.customers (total_spent_amount);
create trigger customers_touch before update on customers.customers
  for each row execute function platform.touch_updated_at();

-- История согласий: только добавление. Единственное допустимое изменение — стирание IP
-- при обезличивании гостя (IP — персональные данные).
create table customers.consents (
  id uuid primary key,
  customer_id uuid not null references customers.customers(id),
  kind text not null check (kind in ('personal_data', 'marketing')),
  granted boolean not null,
  text_version text not null,
  source text not null check (source in ('web', 'admin', 'phone')),
  ip text,
  recorded_by uuid,
  recorded_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index consents_customer_idx on customers.consents (customer_id, recorded_at desc);

create or replace function customers.consents_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Consent history is append-only' using errcode = 'restrict_violation';
  end if;
  if new.ip is not null
     or (new.id, new.customer_id, new.kind, new.granted, new.text_version, new.source, new.recorded_by, new.recorded_at, new.created_at)
        is distinct from
        (old.id, old.customer_id, old.kind, old.granted, old.text_version, old.source, old.recorded_by, old.recorded_at, old.created_at)
  then
    raise exception 'Consent history is append-only (only IP erasure is allowed)' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;
create trigger consents_append_only before update or delete on customers.consents
  for each row execute function customers.consents_append_only();

-- Тексты согласий: версионируются, опубликованная версия не меняется (доказательство того,
-- с каким текстом согласился гость).
create table customers.consent_texts (
  id uuid primary key,
  kind text not null check (kind in ('personal_data', 'marketing')),
  version text not null check (version ~ '^[A-Za-z0-9._-]{1,32}$'),
  text jsonb not null,
  published_at timestamptz not null,
  published_by uuid,
  created_at timestamptz not null default now()
);
create unique index consent_texts_kind_version_uq on customers.consent_texts (kind, version);
create index consent_texts_current_idx on customers.consent_texts (kind, published_at desc, id desc);
create trigger consent_texts_append_only before update or delete on customers.consent_texts
  for each row execute function platform.forbid_update_delete();

-- История гостя (проекция событий заказов, броней, банкетов, сертификатов). Только добавление.
-- Суммы за период считаются по строкам с counts_as_spent (возврат по выполненному заказу — отрицательная сумма).
create table customers.activities (
  id uuid primary key,
  customer_id uuid not null references customers.customers(id),
  type text not null check (type in (
    'order_placed', 'order_completed', 'order_cancelled', 'order_refunded',
    'reservation_created', 'reservation_arrived', 'reservation_no_show', 'reservation_cancelled', 'reservation_expired',
    'reservation_status_changed',
    'banquet_requested', 'banquet_status_changed', 'banquet_held', 'banquet_cancelled', 'banquet_invoice_issued',
    'certificate_purchased'
  )),
  entity_type text not null,
  entity_id text not null,
  branch_id uuid,
  money_amount bigint,
  money_currency char(3) not null default 'KZT',
  counts_as_spent boolean not null default false,
  summary text not null,
  meta jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  source_event_id uuid,
  created_at timestamptz not null default now(),
  constraint activities_spent_amount check (
    not counts_as_spent or (money_amount is not null and (money_amount >= 0 or type = 'order_refunded'))
  )
);
create unique index activities_source_event_uq on customers.activities (source_event_id, type) where source_event_id is not null;
create index activities_customer_idx on customers.activities (customer_id, occurred_at desc);
create index activities_branch_idx on customers.activities (branch_id, customer_id);
create trigger activities_append_only before update or delete on customers.activities
  for each row execute function platform.forbid_update_delete();

-- Связь банкетной заявки с гостем (в событии о счёте нет контакта — только requestId).
create table customers.banquet_links (
  request_id text primary key,
  customer_id uuid not null references customers.customers(id),
  number text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index banquet_links_customer_idx on customers.banquet_links (customer_id);
create trigger banquet_links_touch before update on customers.banquet_links
  for each row execute function platform.touch_updated_at();

-- Сегменты: сохранённые фильтры для выгрузки.
create table customers.segments (
  id uuid primary key,
  name text not null check (length(name) between 1 and 120),
  description text,
  filter jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index segments_name_uq on customers.segments (lower(name)) where deleted_at is null;
create trigger segments_touch before update on customers.segments
  for each row execute function platform.touch_updated_at();

-- Подтверждение телефона SMS-кодом. Код хранится только в виде HMAC. Записи старше суток удаляются
-- расписанием (телефон — персональные данные, дольше хранить незачем).
create table customers.phone_verifications (
  id uuid primary key,
  phone text not null check (phone ~ '^\+7\d{10}$'),
  code_hash text not null,
  locale text not null default 'ru' check (locale in ('kk', 'ru', 'en')),
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  verified_at timestamptz,
  superseded_at timestamptz,
  ip text,
  created_at timestamptz not null
);
create index phone_verifications_phone_idx on customers.phone_verifications (phone, created_at desc);
create index phone_verifications_created_idx on customers.phone_verifications (created_at);
