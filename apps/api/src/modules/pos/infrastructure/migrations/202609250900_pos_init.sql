-- POS: сопоставление блюд с товарами кассовой системы точки, передача заказов на кухню,
-- синхронизация стоп-листа, импортированная номенклатура POS.
-- Все таблицы — в схеме pos. Внешних ключей на таблицы других модулей нет:
-- branch_id, dish_id, order_id — просто идентификаторы.
create schema if not exists pos;

-- ---------------------------------------------------------------- Сопоставление блюд

-- Блюдо витрины (dish_id) <-> товар POS (external_product_id) в филиале для конкретного провайдера.
-- modifier_mappings: { "<optionId>": { "externalProductId": "...", "externalGroupId": "..." | null } }.
create table pos.product_mappings (
  id uuid primary key,
  branch_id uuid not null,
  dish_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  external_product_id text not null check (length(btrim(external_product_id)) between 1 and 200),
  external_name text check (external_name is null or length(external_name) <= 300),
  modifier_mappings jsonb not null default '{}'::jsonb check (jsonb_typeof(modifier_mappings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- Одно блюдо — один товар POS в филиале у провайдера.
create unique index product_mappings_dish_uq on pos.product_mappings (branch_id, provider, dish_id) where deleted_at is null;
create index product_mappings_external_idx on pos.product_mappings (branch_id, provider, external_product_id) where deleted_at is null;
create trigger product_mappings_touch before update on pos.product_mappings
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Передача заказов в POS

create table pos.order_exports (
  id uuid primary key,
  order_id uuid not null,
  order_number text not null,
  branch_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  status text not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  pos_order_id text,
  -- Попытки текущего цикла передачи (сбрасываются при ручном повторе; история — в журнале действий).
  attempts integer not null default 0 check (attempts >= 0),
  manual_retries integer not null default 0 check (manual_retries >= 0),
  last_error text,
  failure_reason text check (
    failure_reason is null
    or failure_reason in ('missing_mapping', 'not_configured', 'rejected', 'retries_exhausted', 'order_unavailable')
  ),
  skip_reason text check (skip_reason is null or skip_reason in ('manual_provider', 'order_cancelled', 'order_not_accepted')),
  -- Подробности неудачи: блюда и опции без сопоставления.
  details jsonb not null default '{}'::jsonb,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_exports_sent_has_pos_id check (status <> 'sent' or pos_order_id is not null),
  constraint order_exports_failed_has_reason check (status <> 'failed' or failure_reason is not null),
  constraint order_exports_skipped_has_reason check (status <> 'skipped' or skip_reason is not null)
);
-- Один заказ — одна запись передачи (идемпотентность подписчика и задачи).
create unique index order_exports_order_uq on pos.order_exports (order_id);
create index order_exports_branch_idx on pos.order_exports (branch_id, status, created_at desc);
create index order_exports_created_idx on pos.order_exports (created_at desc);
create trigger order_exports_touch before update on pos.order_exports
  for each row execute function platform.touch_updated_at();
-- Записи о передаче заказов — часть истории заказа: физическое удаление запрещено.
create trigger order_exports_forbid_delete before delete on pos.order_exports
  for each row execute function platform.forbid_delete();

-- ---------------------------------------------------------------- Стоп-лист POS

-- Последнее известное состояние доступности сопоставленных блюд по данным POS.
-- Изменения в стоп-листе витрины отправляются только при расхождении с этим снимком.
create table pos.stop_list_snapshots (
  branch_id uuid not null,
  dish_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  external_product_id text not null,
  available boolean not null,
  updated_at timestamptz not null default now(),
  primary key (branch_id, dish_id)
);
create trigger stop_list_snapshots_touch before update on pos.stop_list_snapshots
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Номенклатура POS

-- Импортированные товары POS (для экрана сопоставления и автоподбора по названию).
create table pos.products (
  id uuid primary key,
  branch_id uuid not null,
  provider text not null check (provider ~ '^[a-z0-9_]+$'),
  external_product_id text not null,
  name text not null,
  name_normalized text not null,
  sku text,
  kind text not null check (kind in ('dish', 'good', 'modifier', 'service', 'other')),
  group_name text,
  imported_at timestamptz not null,
  -- Товар пропал из номенклатуры POS при последнем импорте.
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index products_external_uq on pos.products (branch_id, provider, external_product_id);
create index products_branch_idx on pos.products (branch_id, provider, name_normalized) where removed_at is null;
create trigger products_touch before update on pos.products
  for each row execute function platform.touch_updated_at();

-- ---------------------------------------------------------------- Состояние синхронизации по филиалам

create table pos.sync_state (
  branch_id uuid primary key,
  stop_list_provider text,
  stop_list_enqueued_at timestamptz,
  stop_list_attempted_at timestamptz,
  -- Последняя успешная синхронизация стоп-листа.
  stop_list_synced_at timestamptz,
  stop_list_failures integer not null default 0 check (stop_list_failures >= 0),
  stop_list_error text,
  stop_list_alerted_at timestamptz,
  stop_list_changes integer not null default 0 check (stop_list_changes >= 0),
  products_provider text,
  products_requested_at timestamptz,
  products_imported_at timestamptz,
  products_count integer check (products_count is null or products_count >= 0),
  products_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sync_state_touch before update on pos.sync_state
  for each row execute function platform.touch_updated_at();
